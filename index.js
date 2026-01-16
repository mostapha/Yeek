import { 
  Client, GatewayIntentBits, ButtonBuilder, ButtonStyle, ActionRowBuilder, Events, ChannelType, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, RESTJSONErrorCodes, Partials
} from 'discord.js';
import { config } from 'dotenv';
import { readFile, writeFile } from 'fs/promises';
import { readFileSync as readSync } from 'fs';
import guides from './guides.json' with { type: 'json' };
import { insertCommon } from './guides/common.js';


import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

config();

// Config placeholders - replace with real IDs or load from env
const REGISTER_CHANNEL_IDS = process.env.ALLOWED_REGISTER_CHANNELS_ID.split(',') // allowed channels for non mods/admins
const ADMINS_AND_MODS_IDS = process.env.ADMINS_AND_MODS_IDS.split(',');
const CALLERS_ROLES_IDS = process.env.CALLERS_ROLES_IDS.split(',');

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID,
      MEMBER_ROLE_ID = process.env.MEMBER_ROLE_ID,
      EOLMEMBER_ROLE_ID = process.env.EOLMEMBER_ROLE_ID,
      INTERN_ROLE_ID = process.env.INTERN_ROLE_ID;

const YEEK_COMMANDS_CHANNEL = process.env.YEEK_COMMANDS_CHANNEL;

// Albion API base
const ALBION_SEARCH_API = 'https://gameinfo-ams.albiononline.com/api/gameinfo/search?q=';

// SQLite DB file location (in bot root)
const DB_PATH = path.resolve('./registrations.sqlite3');

// Initialize DB (creates file and table if needed)
if (!fs.existsSync(DB_PATH)) {
  // file will be created by better-sqlite3 automatically
  console.log('Creating new SQLite DB at', DB_PATH);
}
const db = new Database(DB_PATH);

// Create table if missing
db.prepare(`
  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT NOT NULL UNIQUE,
    game_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    game_id TEXT NOT NULL,
    registered_by TEXT NOT NULL,
    registered_at TEXT NOT NULL
  );
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS internal_notes (
    discord_id TEXT PRIMARY KEY,
    note TEXT,
    updated_at TEXT
  );
`).run();

// Ensure comps table exists
db.exec(`
CREATE TABLE IF NOT EXISTS comps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  thread_id TEXT,
  organizer_id TEXT NOT NULL,
  slots_json TEXT NOT NULL,
  raw_input TEXT,
  created_at INTEGER NOT NULL
);
`);

// After database initialization
function cleanupOldComps() {
  try {
    const fifteenDaysAgo = Date.now() - (15 * 24 * 60 * 60 * 1000);
    const result = db.prepare('DELETE FROM comps WHERE created_at < ?').run(fifteenDaysAgo);
    if (result.changes > 0) {
      console.log(`Cleaned up ${result.changes} old comp(s) (older than 15 days)`);
    }
  } catch (err) {
    console.error('Failed to cleanup old comps:', err);
  }
}


// HELPERS FOR COMP START
// Helper: create comp
function createCompRecord({ guildId, channelId, organizerId, slotsArray, rawInput }) {
  const stmt = db.prepare(`
    INSERT INTO comps (guild_id, channel_id, organizer_id, slots_json, raw_input, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    guildId, 
    channelId, 
    organizerId, 
    JSON.stringify(slotsArray), // only roles (for backwards compatibility)
    rawInput,                    // full text with comments
    Date.now()
  );
  return info.lastInsertRowid;
}

// Helper: get comp by id
function getCompById(id) {
  const row = db.prepare('SELECT * FROM comps WHERE id = ?').get(id);
  if (!row) return null;
  return {
    ...row,
    slots: JSON.parse(row.slots_json),
    raw_input: row.raw_input || null // might be null for old comps
  };
}

// Helper: get comp by thread id
function getCompByThreadId(threadId) {
  const row = db.prepare('SELECT * FROM comps WHERE thread_id = ?').get(threadId);
  if (!row) return null;
  return {
    ...row,
    slots: JSON.parse(row.slots_json),
    raw_input: row.raw_input || null
  };
}
// Helper: update comp (partial updates supported)
function updateCompRow(id, fields = {}) {
  const allowed = ['message_id', 'thread_id', 'slots_json', 'raw_input']; // add raw_input here
  const parts = [];
  const values = [];
  for (const k of Object.keys(fields)) {
    if (!allowed.includes(k)) continue;
    parts.push(`${k} = ?`);
    values.push(fields[k]);
  }
  if (parts.length === 0) return;
  values.push(id);
  const sql = `UPDATE comps SET ${parts.join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...values);
}

// Helper: show edit comp modal
async function showEditCompModal(interaction, comp) {
  // Build modal prefilled with current values
  const modal = new ModalBuilder()
    .setCustomId(`edit_comp_modal-${comp.id}-${interaction.user.id}-${Date.now()}`)
    .setTitle(`Edit comp #${comp.id}`);

  // Use raw_input if available, otherwise fall back to reconstructing from slots
  const slotsText = comp.raw_input || comp.slots.map(s => s.roleName).join('\n');

  const slotsInput = new TextInputBuilder()
    .setCustomId('comp_slots')
    .setLabel('Slots (one role name per line)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setValue(slotsText);

  modal.addComponents(
    new ActionRowBuilder().addComponents(slotsInput)
  );

  await interaction.showModal(modal);

}

// Helper: update slots array
function updateCompSlots(id, slotsArray) {
  updateCompRow(id, { slots_json: JSON.stringify(slotsArray) });
}

// Build the plain-text comp message body
function buildCompMessageBody(comp) {
  // New behavior: parse raw_input and inject signups
  const lines = [];
  const allLines = comp.raw_input.split(/\r?\n/).map(s => s.trim());
  let roleIndex = 0;
  
  allLines.forEach((line) => {
    if (!line) {
      lines.push(''); // empty line
      return
    }
    
    if (line.startsWith('>')) {
      // Comment line - replace @highlander
      lines.push(line.slice(1).trimStart().replace(/@highlander/gi, `<@&${MEMBER_ROLE_ID}>`));
      return;
    }
    
    // Role line - add with number and signup if exists
    const slot = comp.slots[roleIndex];
    roleIndex++;

    // Parse role name and optional comment (separated by ~)
    const parts = slot.roleName.split('~', 2);
    const roleName = parts[0].trim();
    const comment = parts[1]?.trim();

    // Build the line components
    const userMention = slot.playerId ? ` <@${slot.playerId}>` : '';
    const formattedComment = comment ? ` _~${comment.replaceAll('_','\\_')}_` : '';

    // Combine: roleIndex. roleName [@playerId] [~comment]
    lines.push(`${roleIndex}. ${roleName}${userMention}${formattedComment}`);

  });
  
  return lines.join('\n');
}

const compQueues = new Map();
async function runWithCompLock(compId, operation) {
  let currentPromise = compQueues.get(compId) ?? Promise.resolve();
  
  const newPromise = currentPromise
    .then(operation)
    .catch(err => {
      console.error(`Error in comp ${compId} operation:`, err);
    });
  
  compQueues.set(compId, newPromise);
  
  newPromise.finally(() => {
    if (compQueues.get(compId) === newPromise) {
      compQueues.delete(compId);
    }
  });
  
  return newPromise;
}

// CORE: run the actual signup/unassign logic using the fetched message object.
// Returns { ok: true } on handled signup, { ok: false, reason: '...' } on handled failure.
async function runSignupLogic(item, message, compId, parsed_data) {
  try {
    const isUnassign = parsed_data.isNegative;
    const idx = parsed_data.roleNumber;

    const fresh = getCompById(compId);
    if (!fresh) {
      await message.react('❌').catch(() => {});
      return { ok: false, reason: 'no_comp' };
    }
    const slots = fresh.slots;
    if (isNaN(idx) || idx < 1 || idx > slots.length) {
      await message.react('❌').catch(() => {});
      await message.reply('Invalid role number.').catch(() => {});
      return { ok: false, reason: 'bad_index' };
    }
    const target = slots[idx - 1];

    if (isUnassign) {
      if (!target.playerId) {
        await message.react('❌').catch(() => {});
        await message.reply('Role is already empty.').catch(() => {});
        return { ok: false, reason: 'slot_empty' };
      }
      const senderId = String(item.authorId);
      const organizerId = String(fresh.organizer_id);
      const senderIsOwner = target.playerId === senderId;
      const senderIsOrganizer = senderId === organizerId;
      if (!senderIsOwner && !senderIsOrganizer) {
        await message.react('❌').catch(() => {});
        await message.reply('You are not signed in that role.').catch(() => {});
        return { ok: false, reason: 'not_allowed' };
      }

      target.playerId = null;
      target.playerName = null;
      updateCompSlots(fresh.id, slots);
      try {
        const ch = await client.channels.fetch(fresh.channel_id);
        const posted = await ch.messages.fetch(fresh.message_id);
        await posted.edit(buildCompMessageBody({ ...fresh, slots }));
      } catch (e) {
        if (e.code === 10008) {  // Unknown message
          await message.reply('The comp message was deleted, maybe this is an old thread');
        } else {
          console.error('Failed to update comp message after unassign:', e);
          await message.reply('Failed to update comp message after unassign');
        }
      }
      await message.react('✅').catch(() => {});
      return { ok: true };
    }

    // SIGNUP flow
    const alreadyAssigned = slots.find(s => s.playerId === String(item.authorId));
    if (alreadyAssigned) {
      await message.react('❌').catch(() => {});
      await message.reply(`You are already signed as \`${alreadyAssigned.roleName}\``).catch(() => {});
      return { ok: false, reason: 'already_signed' };
    }
    if (target.playerId) {
      await message.react('❌').catch(() => {});
      await message.reply('This role is already taken.').catch(() => {});
      return { ok: false, reason: 'taken' };
    }

    target.playerId = String(item.authorId);
    target.playerName = item.displayName;
    updateCompSlots(fresh.id, slots);
    try {
      const ch = await client.channels.fetch(fresh.channel_id);
      const posted = await ch.messages.fetch(fresh.message_id);
      await posted.edit(buildCompMessageBody({ ...fresh, slots }));
    } catch (e) {
      if (e.code === 10008) {  // Unknown message
        await message.reply('The comp message was deleted, maybe this is an old thread');
      } else {
        console.error('Failed to update comp message after signup:', e);
        await message.reply('Failed to update comp message after signup');
      }
    }
    await message.react('✅').catch(() => {});
    return { ok: true };
  } catch (err) {
    console.error('_runSignupLogic error:', err);
    try { await message.react('❌'); } catch {}
    return { ok: false, reason: 'error' };
  }
}


// HELPERS FOR COMP END

// ---------- DB helpers ----------

// applyRegistration inserts/updates DB

// internal_notes helpers
function getInternNote(discordId) {
  const row = db.prepare('SELECT note FROM internal_notes WHERE discord_id = ?').get(discordId);
  return row ? row.note : '';
}

function upsertInternNote(discordId, note) {
  const now = new Date().toISOString();
  if (!note || note.trim() === '') {
    db.prepare('DELETE FROM internal_notes WHERE discord_id = ?').run(discordId);
    return { action: 'deleted' };
  }
  const exists = db.prepare('SELECT 1 FROM internal_notes WHERE discord_id = ?').get(discordId);
  if (exists) {
    db.prepare('UPDATE internal_notes SET note = ?, updated_at = ? WHERE discord_id = ?').run(note, now, discordId);
    return { action: 'updated' };
  } else {
    db.prepare('INSERT INTO internal_notes (discord_id, note, updated_at) VALUES (?, ?, ?)').run(discordId, note, now);
    return { action: 'created' };
  }
}


async function addRegistrationToDB(targetDiscordId, player, registeredById) {
  // DB operations:
  try {
    const stmt = db.prepare(`
    INSERT INTO registrations (discord_id, game_name, game_id, registered_by, registered_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
    stmt.run(targetDiscordId, player.Name, player.Id, registeredById);
  } catch (err) {
    console.error('DB write failed', err);
    return { success: false, error: 'DB write failed' };
  }

  // Changing nickname should be done where you have guild context.
  // It's easier to perform nickname change in the caller (origin) which has message/interaction & guild.
  // So return success and let the caller set nickname afterwards.
  return { success: true };
}


function removeRegistrationByDiscordId(discordId) {
  const stmt = db.prepare(`DELETE FROM registrations WHERE discord_id = ?`);
  return stmt.run(discordId);
}

function findByGameName(gameName) {
  return db.prepare(`SELECT * FROM registrations WHERE game_name = ?`).get(gameName);
}

function findByDiscordId(discordId) {
  return db.prepare(`SELECT * FROM registrations WHERE discord_id = ?`).get(discordId);
}

// ---------- Small register helpers ----------
function checkDiscordRegistration(discordId) {
  return findByDiscordId(discordId); // returns row or undefined
}

function checkGameRegistration(gameName) {
  return findByGameName(gameName); // returns row or undefined
}


// parse args: returns { targetId, nameArg, mention }
function parseRegisterArgs(message) {
  const parts = message.content.trim().split(/\s+/).slice(1); // Get words after command
  let targetId = message.author.id;
  let mention = null;

  // Regex to check if the FIRST argument is strictly a user mention format (<@123...> or <@!123...>)
  const mentionRegex = /^<@!?(\d+)>$/;

  if (parts.length > 0) {
    const match = parts[0].match(mentionRegex);
    
    // If the first word is a mention, we assume they want to register that user
    if (match) {
      const extractedId = match[1];
      // Verify this ID actually exists in the message mentions collection
      const mentionedUser = message.mentions.users.get(extractedId);
      
      if (mentionedUser) {
        mention = mentionedUser;
        targetId = extractedId;
        parts.shift(); // Remove the mention from the arguments so the rest is the name
      }
    }
  }

  const nameArg = parts.join(' ').trim();
  return { targetId, nameArg, mention };
}

// ---------- Albion API helper ----------
async function searchAlbion(name) {
  const url = ALBION_SEARCH_API + encodeURIComponent(name);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Albion API error: ' + res.status);
  return res.json(); // contains players array
}

// ---------- permission helper ----------
function isAdminOrMod(member) {
  if (!member) return false;
  return member.roles?.cache?.some(r => ADMINS_AND_MODS_IDS.includes(r.id));
}


const statsPath = new URL('./stats.json', import.meta.url);
let stats;

// Load existing stats or initialize
try {
  const raw = readSync(statsPath);
  stats = JSON.parse(raw);
} catch {
  stats = { weapons: {}, users: {} };
}
if (!stats.names) stats.names = {};

const saveStats = async () => {
  try {
    await writeFile(statsPath, JSON.stringify(stats, null, 2));
  } catch (err) {
    console.error('Failed to save stats:', err);
  }
};

// Update in-memory stats and persist
function recordStat(userId, weapon, displayName) {
  // Weapon totals
  stats.weapons[weapon] = (stats.weapons[weapon] || 0) + 1;

  // Per-user breakdown
  if (!stats.users[userId]) {
    stats.users[userId] = { total: 0, weapons: {} };
  }
  stats.users[userId].total++;
  stats.users[userId].weapons[weapon] = (stats.users[userId].weapons[weapon] || 0) + 1;

  stats.names[userId] = displayName;

  saveStats();
}



// Your role tree data
const rolesTree = [
  {
    name: 'Tank',
    icon: 'https://i.imgur.com/pTz9rko.png',
    title: 'Tank Roles',
    text: "The tanks can sustain damage more than any other role, that's why they usually play in frontlines, there are different types of tanks and here are some of them",
    children: [
      {
        name: 'Clumper Tank',
        title: 'Clumper Tanks',
        text: 'The clumper or engage tanks are the ones who gather and clump enemy players at one place to help our DPS kill them, they can also do fake engages or help the caller catch more people',
        children: [
          {
            name: 'Golem',
            title: 'Earthrune Staff (Golem)',
            icon: 'https://render.albiononline.com/v1/item/T8_2H_SHAPESHIFTER_KEEPER?quality=4&size=60',
            text: 'One of the best clumping weapons in the game; can make clumps both using W and E spell; the E spell pulls any amount of players in range; 25 seconds cooldown.'
          },
          {
            name: 'Hoj',
            title: 'Hand of Justice',
            icon: 'https://render.albiononline.com/v1/item/T8_2H_HAMMER_AVALON?quality=4&size=60',
            text: 'Very nice clumping weapon; used mostly in small-scale fights; needs more skill compared to golem; can only pull 10 players max; 30 seconds cooldown.'
          },
          {
            name: '1h Mace',
            title: '1h Mace',
            icon: 'https://render.albiononline.com/v1/item/T8_MAIN_MACE?quality=4&size=60',
            text: 'decent clumping weapon; you clump with your W spell (Air Compressor); pulls all players in range of the spell; 30 seconds cooldown'
          },
          {
            name: 'Camlann',
            title: 'Camlann Mace',
            icon: 'https://render.albiononline.com/v1/item/T8_2H_MACE_MORGANA?quality=4&size=60',
            text: 'Out of meta weapon; not used often; You hit enemy player with E spell then all enemies around him get pulled to him; 25 seconds cooldown'
          }
        ]
      },
      {
        name: 'Stopper Tank',
        title: 'Stopper Tanks',
        text: 'Tanks that defend our team from enemy engages, their job is to watch enemy zerg and stop them when they try to engage us',
        children: [
          {
            name: 'Heavy Mace',
            title: 'Heavy Mace',
            icon: 'https://render.albiononline.com/v1/item/T8_2H_MACE?quality=4&size=60',
            text: 'Great stopping weapon; have many utilities to stop enemies; Q spell (silences); W spell (roots, interrupts); E spell (silences); used with hellion hood or judicator helmet'
          },
          {
            name: '1h Mace',
            title: '1h Mace',
            icon: 'https://render.albiononline.com/v1/item/T8_MAIN_MACE?quality=4&size=60',
            text: 'Same as Heavy Mace, great stopping weapon; all the spells can help stop engages, especially the W (roots, interrupts) and the E spell (slows, interrupts); used with hellion hood or judicator helmet'
          },
          {
            name: '1h Hammer',
            title: '1h Hammer',
            icon: 'https://render.albiononline.com/v1/item/T8_MAIN_HAMMER?quality=4&size=60',
            text: "1h hammer is decent to stop and control enemy zerg; the E spell have long stun time; it doesn't have mobility but has short cooldown (15s); can either use second W (dash towards enemy) or last W (Inertia Ring) to slow enemy engages; used with hellion hood or judicator helmet; best played in brawl fights"
          },
          {
            name: 'Great Hammer',
            title: 'Great Hammer',
            icon: 'https://render.albiononline.com/v1/item/T8_2H_HAMMER?quality=4&size=60',
            text: 'Just another 1h hammer but with some mobility; Can stop engages by dashing to enemies (knocks them back and stun them); can use last W to slow; used with hellion hood or judicator helmet'
          },
          {
            name: 'Grovekeeper',
            title: 'Grovekeeper',
            icon: 'https://render.albiononline.com/v1/item/T8_2H_RAM_KEEPER?quality=4&size=60',
            text: 'Stops engages using E spell by jumping towards them and lock them in place (stuns, throwing in air); same as other hammer we use last W to slow and we use it with hellion hood or judicator helmet'
          },
          {
            name: 'Grail Seeker',
            title: 'Grail Seeker',
            icon: 'https://render.albiononline.com/v1/item/T8_2H_QUARTERSTAFF_AVALON?quality=4&size=60',
            text: 'Stops engages using E spell by rooting enemies for very long time; we use last Q (Cartwheel) and 4th W (Rising Blow) for more cc; also used with hellion hood or judicator helmet'
          }
        ]
      },
      {
        name: 'Support Tank',
        title: 'Support Tanks',
        text: 'This tanks support the team by puting pressure on enemy zerg or by helping the caller catch more people',
        children: [
          {
            name: 'Staff of balance',
            title: 'Staff of balance',
            icon: 'https://render.albiononline.com/v1/item/T8_2H_ROCKSTAFF_KEEPER?quality=4&size=60',
            text: 'Staff of balance goes inside enemy zerg and uses his E to slow them by 50% and reduce their healing by 35%'
          },
          {
            name: '1h Mace',
            title: '1h Mace',
            icon: 'https://render.albiononline.com/v1/item/T8_MAIN_MACE?quality=4&size=60',
            text: "1h mace has a lot of crowd control spells; it's great for putting pressure on enemy as you just keep controlling them over and over"
          },
          {
            name: 'Heavy mace',
            title: 'Heavy mace',
            icon: 'https://render.albiononline.com/v1/item/T8_2H_MACE?quality=4&size=60',
            text: 'Same as 1h mace, a lot of crowd controls spells, when used offensively you can just control enemies over and over which help the team a lot'
          },
          {
            name: 'Forge Hammers',
            title: 'Forge Hammers',
            icon: 'https://render.albiononline.com/v1/item/T8_2H_DUALHAMMER_HELL?quality=4&size=60',
            text: 'Forge Hammers E spell makes you very tanky, you can go inside enemy zerg and use E spell and keep crashing and controlling them over and over (slows, throws in air), very good pressure weapon'
          },
        ]
      }
    ]
  },
  {
    name: 'Support',
    icon: 'https://i.imgur.com/Qcrm1N9.png',
    title: 'Support Roles',
    text: 'Support roles are all about helping the team either defensively or offensively.',
    children: [
      {
        name: 'Defensive support',
        title: 'Defensive support',
        text: 'Defensive support usually assist the team by giving shields, cleanses and different utilities that keeps the team alive',
        children: [
          {
            name: '1h arcane',
            title: 'Arcane Staff',
            icon: 'https://render.albiononline.com/v1/item/T8_MAIN_ARCANESTAFF?quality=4&size=60',
            text: "The E spell silences and purges enemy players hit, it's good to stop engages and bombs; and because it's an arcane we also get cool spells from Q and W like the shields and cleanse"
          },
          {
            name: 'Great arcane',
            title: 'Great arcane',
            icon: 'https://render.albiononline.com/v1/item/T8_2H_ARCANESTAFF?quality=4&size=60',
            text: "The E spell Stops and freezes enemy players for short time, they can't do anything in that time, so it's good to stop or set up engages; and because it's an arcane we also get cool spells from Q and W like the shields and cleanse"
          },
          {
            name: 'Bedrock',
            title: 'Bedrock Mace',
            icon: 'https://render.albiononline.com/v1/item/T8_MAIN_ROCKMACE_KEEPER?quality=4&size=60',
            text: "The E spell knocks enemies back for long distance; it's good to delay enemies from engaging or to block them from coming closer; and because it's a mace get nice spells from the W and Q like Guard Rune that gives defense and immunity of movements effects"
          },
          {
            name: 'Locus',
            title: 'Malevolent Locus',
            icon: 'https://render.albiononline.com/v1/item/T8_2H_ENIGMATICORB_MORGANA?quality=4&size=60',
            text: "The E spell create a big area of buff to allies, the area gives damage resistance and keeps cleansing all crowd control effects; and because it's an arcane we also get cool spells from Q and W like the shields and cleanse"
          },
          {
            name: 'Rootbound',
            title: 'Rootbound Staff',
            icon: 'https://render.albiononline.com/v1/item/T8_2H_SHAPESHIFTER_SET2?quality=4&size=60',
            text: 'The E spell of Rootbound gives more HP to allies around, and give you access to a spell that shield allies for up to 3 seconds and protects from movements spells'
          },
          {
            name: 'Oathkeepers',
            title: 'Oathkeepers',
            icon: 'https://render.albiononline.com/v1/item/T8_2H_DUALMACE_AVALON?quality=4&size=60',
            text: "The E spell of Oathkeepers gives shield to allies, the shield blocks some damage and grants bonus movement speed; and because it's a mace you get nice spells from the Q and W like Guard Rune that gives defense and immunity to movements effects"
          },
          {
            name: 'Enigmatic',
            title: 'Enigmatic Staff',
            icon: 'https://render.albiononline.com/v1/item/T8_2H_ENIGMATICSTAFF?quality=4&size=60',
            text: "The E spell shield an ally and the people around him, it's good defensive tool; and because it's an arcane we also get cool spells from Q and W like the shields and cleanse"
          },
          {
            name: 'Black monk',
            title: 'Black Monk Stave',
            icon: 'https://render.albiononline.com/v1/item/T8_2H_COMBATSTAFF_MORGANA?quality=4&size=60',
            text: 'The E spell of Black Monk Stave reduces damage of enemies hit by 30% each 0.75s; so if enemy tried to engage but black monk hit them they will barely do any damage to us'
          }
        ]
      },
      {
        name: 'Offensive support',
        title: 'Offensive support',
        text: "The offensive support is the ones who make it easier to secure kills, it's usually weapons that put debuffs on enemies and make them weaker and vulnerable to our damage",
        children: [
          {
            name: 'HP cut',
            title: 'HP cut',
            text: 'The hp cut support are weapons that reduce max and current health points to enemies, enemies with less health are easier to kill',
            children: [
              {
                name: 'Incubus',
                title: 'Incubus Mace',
                icon: 'https://render.albiononline.com/v1/item/T8_MAIN_MACE_HELL?quality=4&size=60',
                text: "The incubus mace can reduce max and current HP to enemies by 25% for 8 seconds, it take nearly half HP of players; and because it's a mace we also get Guard Rune and silence Q"
              },
              {
                name: 'Realmbreaker',
                title: 'Realmbreaker',
                icon: 'https://render.albiononline.com/v1/item/T8_2H_AXE_AVALON?quality=4&size=60',
                text: 'We can also consider it as DPS weapon, but the Realmbreaker takes 15% max and current HP from enemies hit plus the damage it deals, which makes it very good offensive support weapon'
              },
            ]
          },
          {
            name: 'Resistance Reduction',
            title: 'Damage Resistance Reduction',
            text: "There are weapons that reduce the damage resistance from enemies, it's very imprortant to have some of them in the party to make sure you get kills when engaging; Enemies with less damage resistance are easier to kill",
            children: [
              {
                name: 'Damnation',
                title: 'Damnation Staff',
                icon: 'https://render.albiononline.com/v1/item/T8_2H_CURSEDSTAFF_MORGANA?quality=4&size=60',
                text: 'The damnation E spell makes a big area of pierce, it reduces damage resistances to all people around the targeted area which makes it one of the best piercing weapons; the only downside is slow cast time which can be fixed using scholar robe or morgana cape'
              },
              {
                name: 'Spirit',
                title: 'Spirithunter',
                icon: 'https://render.albiononline.com/v1/item/T8_2H_HARPOON_HELL?quality=4&size=60',
                text: 'Spirithunter is a pierce weapon that also does damage; it reduces magical resistance and damage resistances for enemies hit; it can hit immediately which makes it great piercing choice'
              },
              {
                name: 'Shadowcaller',
                title: 'Shadowcaller',
                icon: 'https://render.albiononline.com/v1/item/T8_MAIN_CURSEDSTAFF_AVALON?quality=4&size=60',
                text: "Shadowcaller is the weapon with most damage resistance reduction, getting hit by shadowcaller makes you nearly naked, the only downside is that it's a little bit slow and needs to time it right to get benefit of it"
              },
              {
                name: 'Carving',
                title: 'Carving Sword',
                icon: 'https://render.albiononline.com/v1/item/T8_2H_CLEAVER_HELL?quality=4&size=60',
                text: "Carving sword is a pierce weapon worth mentioning, it reduces damage resistance based on stacks from Q's and W's, the more stacks you have the more pierce you get"
              }
            ]
          },
          {
            name: 'Other offensive support',
            title: 'Other offensive support',
            text: 'There are other offensive support weapons that give special abilities and helps the team secure kills in the engages',
            children: [
              {
                name: 'Lifecurse',
                title: 'Lifecurse Staff',
                icon: 'https://render.albiononline.com/v1/item/T8_MAIN_CURSEDSTAFF_UNDEAD?quality=4&size=60',
                text: 'The Lifecurse E purges all buffs from enemies hit (shields, helmets, jacket, boots buffs all get purged), it also does damage over time to them'
              },
              {
                name: 'Rotcaller',
                title: 'Rotcaller',
                icon: 'https://render.albiononline.com/v1/item/T8_MAIN_CURSEDSTAFF_CRYSTAL?quality=4&size=60',
                text: 'The Rotcaller E spell gives enemies hit a debuff that prevents them from getting healed for 2 seconds'
              },
            ]
          },
        ]
      },
      {
        name: 'Other support',
        title: 'Other support',
        text: 'There are other support that help the team either by giving buffs or debuffing enemy players, and here are some of them',
        children: [
          {
            name: 'Occult',
            title: 'Occult Staff',
            icon: 'https://render.albiononline.com/v1/item/T8_2H_ARCANESTAFF_HELL?quality=4&size=60',
            text: 'Occult staff is a mobility support weapon, the E spell creates a long corridor or carpet that increases the movement speed of all allies by 60%, it can be used either offensively when the is engaging or defensively when team is kiting, or just use it to reposition the zerg.'
          },
          {
            name: 'Icicle Staff',
            title: 'Icicle Staff',
            icon: 'https://render.albiononline.com/v1/item/T8_2H_ICEGAUNTLETS_HELL?quality=4&size=60',
            text: 'The Icicle Staff is a support weapon that slows enemy players. The E spell create an area of blizzard or storm that slows everyone inside by 50%, when played offensively it slows enemies so our team can get to them quickly and when played defensively it slows enemies so our team can kite and get away'
          },
        ]
      },
    ]
  },
  {
    name: 'DPS',
    icon: 'https://i.imgur.com/VzXPai6.png',
    title: 'DPS Roles',
    text: 'The DPS job is to kill clumps, when the caller gathers enemy players or asks to engage the dps players drop their E spells in hope of getting kills',
    children: [
      {
        name: 'Permafrost',
        title: 'Permafrost Prism',
        icon: 'https://render.albiononline.com/v1/item/T8_2H_ICECRYSTAL_UNDEAD?quality=4&size=60',
        text: 'Permafrost is great dps weapon, in addition to its good damage, the E spell stuns enemies and lock them in place. the perma frost player should have fast reaction time and can predict where the engages will be, so he can hit before every other dps'
      },
      {
        name: 'Spiked',
        title: 'Spiked Gauntlets',
        icon: 'https://render.albiononline.com/v1/item/T8_2H_KNUCKLES_SET3?quality=4&size=60',
        text: 'Spiked is a very important DPS weapon. Its special trait is that it deals extra damage to Plate armor users, making it the perfect weapon to kill tanks, we only take 1 spiked per party because the damage does not stack.'
      },
      {
        name: 'Rift',
        title: 'Rift Glaive',
        icon: 'https://render.albiononline.com/v1/item/T8_2H_GLAIVE_CRYSTAL?quality=4&size=60',
        text: 'Rift Glaive is a great DPS weapon. It has very high instant burst damage, which makes it a top pick in clap comps'
      },
      {
        name: 'Hellfire',
        title: 'Hellfire Hands',
        icon: 'https://render.albiononline.com/v1/item/T8_2H_KNUCKLES_HELL?quality=4&size=60',
        text: 'Hellfire Hands is also one of the best dps weapons, in addition to is good damage it also applies a debuff which reduces healing received'
      },
      {
        name: 'Dawnsong',
        title: 'Dawnsong',
        icon: 'https://render.albiononline.com/v1/item/T8_2H_FIRE_RINGPAIR_AVALON?quality=4&size=60',
        text: 'Dawnsong is also one of the best dps weapons, it has nice burst damage in long area and also applies a debuff which reduces healing received to enemies hit'
      },
      {
        name: 'Infinity blade',
        title: 'Infinity blade',
        icon: 'https://render.albiononline.com/v1/item/T8_MAIN_SWORD_CRYSTAL?quality=4&size=60',
        text: "Infinity blade is another decent dps weapon, it does high damage to all enemies in front of you, the E spell increases all damage by 35% for 5 seconds which also oosts the output damage of Q and W spells for a short time, it's good weapon for brawling comps"
      },
      {
        name: 'bear paws',
        title: 'bear paws',
        icon: 'https://render.albiononline.com/v1/item/T8_2H_DUALAXE_KEEPER?quality=4&size=60',
        text: 'Bear paws is good damage weapon when going for brawl comps, you can put so much pressure on enemies while being able to sustain damage while brawling'
      },
      {
        name: 'Battle Bracers',
        title: 'Battle Bracers',
        icon: 'https://render.albiononline.com/v1/item/T8_2H_KNUCKLES_SET2?quality=4&size=60',
        text: 'Very high burst damage weapon, the damage is instant which makes good very good option, the weapon used in melee and brawling comps'
      },
      {
        name: 'Infernal Scythe',
        title: 'Infernal Scythe',
        icon: 'https://render.albiononline.com/v1/item/T8_2H_SCYTHE_HELL?quality=4&size=60',
        text: 'the infernal scythe is decent weapon for brawling comps, it got nerfed to the ground, the E spell now does not stack with other infernal scythes, but having one in the party is good addition to execute low HP enemies'
      },
      {
        name: 'Ursine Maulers',
        title: 'Ursine Maulers',
        icon: 'https://render.albiononline.com/v1/item/T8_2H_KNUCKLES_KEEPER?quality=4&size=60',
        text: 'The Ursine Maulers is a nice addition to melee and brawl comps, the E spell if used correctly does a huge amount of damage to all enemies hit'
      },
      {
        name: 'Longbow',
        title: 'Longbow',
        icon: 'https://render.albiononline.com/v1/item/T8_2H_LONGBOW?quality=4&size=60',
        text: 'The Longbow is a great DPS option, the E spell does a huge damage output if full channeled, we can use it in both brawling or clap comps'
      },
      {
        name: 'Wailing Bow',
        title: 'Wailing Bow',
        icon: 'https://render.albiononline.com/v1/item/T8_2H_BOW_HELL?quality=4&size=60',
        text: 'The Wailing bow E spell does a very high damage if the enemies are stacked, used a lot in bomb squads, can be used in clap comp as it has high burst damage'
      },
      {
        name: 'Heron spear',
        title: 'Heron spear',
        icon: 'https://render.albiononline.com/v1/item/T8_MAIN_SPEAR_KEEPER?quality=4&size=60',
        text: 'The Heron spear can be used in melee, brawl or even one shot comps, the E spell stuns enemies and does very high damage, the W spell also have decent damage which gives the weapon huge damage output if used correctly'
      },
      {
        name: 'Demonfang',
        title: 'Demonfang',
        icon: 'https://render.albiononline.com/v1/item/T8_MAIN_DAGGER_HELL?quality=4&size=60',
        text: 'Demonfang is also a respected choice when going for melee comps or when brawling, the E ability when combined with 1st W spell outputs a huge burst damage'
      },
      {
        name: 'Astral staff',
        title: 'Astral staff',
        icon: 'https://render.albiononline.com/v1/item/T8_2H_ARCANESTAFF_CRYSTAL?quality=4&size=60',
        text: "The Astral Staff is a decent choice for brawling comps, the E spell cannot be interrupted, it's good pressure weapon with high damage that melts enemies if they are not careful"
      },
    ]
  },
  {
    name: 'Healer',
    icon: 'https://i.imgur.com/zzszaGj.png',
    title: 'Healer Roles',
    text: 'Healers focusing on restoring health and supporting allies.',
    children: [
      {
        name: 'Hallowfall',
        title: 'Hallowfall',
        icon: 'https://render.albiononline.com/v1/item/T8_MAIN_HOLYSTAFF_AVALON?quality=4&size=60',
        text: "Hallowfall could be the best healing staff in the game, it has really good healing and comes with a mobility option, it's the first choice for healers in small scale or zvz in general"
      },
      {
        name: 'Redemption',
        title: 'Redemption Staff',
        icon: 'https://render.albiononline.com/v1/item/T8_2H_HOLYSTAFF_UNDEAD?quality=4&size=60',
        text: 'Redemption Staff has huge healing output which makes it decent choice for zvzs, the E spell throws out a ball that bounces between nearby allies and heals every time it passes'
      },
      {
        name: 'Fallen Staff',
        title: 'Fallen Staff',
        icon: 'https://render.albiononline.com/v1/item/T8_2H_HOLYSTAFF_HELL?quality=4&size=60',
        text: 'Fallen Staff heals up to 20 allies with higher output than any other holy staff, and it also gives a 2-second damage immunity shield, removing dots, debuffs, and crowd control. The catch is the effect only starts 2 seconds after you cast, so timing is really important'
      },
      {
        name: 'Blight Staff',
        title: 'Blight Staff',
        icon: 'https://render.albiononline.com/v1/item/T8_2H_NATURESTAFF_HELL?quality=4&size=60',
        text: 'Blight Staff is a solid nature healing option for ZvZ or small scale fights. The E spell gives uninterruptible healing while channeling and boosts movement speed, making it easier to follow allies or reposition, and it can heal up to 10 allies'
      },
    ]
  },
];


// Helper: find node by path
function getNode(path, tree = rolesTree) {
  let node = null;
  let current = tree;
  for (const name of path) {
    node = current.find(n => n.name === name);
    if (!node) break;
    current = node.children || [];
  }
  return node;
}


const embedStartTitle = 'Albion zvz roles';

const intro_text = `
    In organized group fights, it's important to have specific roles in your party to put proper fight. You'll need tanks, support, DPS, and healers. If you're missing one of these, things can get a bit tricky.  

    The number of each role really depends on the type of content or the caller. Some callers like having a lot of tanks, while others want more damage. In general, having a balanced team usually works best.  

    We'll go over some common roles in group fights and how they help the team do well. This is just from my own experience in the game, so it might not cover everything, but it's a good starting point for anyone interested in ZvZ content.
    `
const startedPanelObject = { title: embedStartTitle, text: intro_text, icon: 'https://i.imgur.com/HlGNoNN.png', children: rolesTree };


// Helper: build embed + buttons
function buildMessage(node, path) {
  const embed = new EmbedBuilder()
    .setTitle(node.title)
    .setDescription(node.text);

  if (node.icon) {
    embed.setThumbnail(node.icon);
  }

  const rows = [];

  if (node.children && node.children.length > 0) {
    // split into groups of 5
    for (let i = 0; i < node.children.length; i += 5) {
      const row = new ActionRowBuilder();
      const slice = node.children.slice(i, i + 5);
      for (const child of slice) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`zvzRoles_open:${[...path, child.name].join('>')}`)
            .setLabel(child.name)
            .setStyle(ButtonStyle.Primary)
        );
      }
      rows.push(row);
    }
  }

  // Back button (always in its own row to avoid conflicts)
  if (path.length > 0) {
    const backRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`zvzRoles_back:${path.join('>')}`)
        .setLabel('⬅ Back')
        .setStyle(ButtonStyle.Secondary)
    );
    rows.push(backRow);
  }

  return { embeds: [embed], components: rows, flags: 64 };
}




const client = new Client({
  intents: [GatewayIntentBits.GuildPresences, GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildScheduledEvents, GatewayIntentBits.GuildVoiceStates],
  partials: [
    Partials.Message,   // <-- important to get deleted messages that weren't cached
    Partials.Channel,   // useful if message's channel wasn't cached
  ],
});

client.once(Events.ClientReady, () => {
  console.log(`Bot is ready as ${client.user.tag}`);

  cleanupOldComps();
});


async function fetchAlbionPlayers(nickname) {
  const url = `https://gameinfo-ams.albiononline.com/api/gameinfo/search?q=${encodeURIComponent(
    nickname
  )}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.players || [];
}
function formatAlbionName(player) {
  if (!player.GuildName) return player.Name;
  let guild = player.GuildName;
  if (guild.toLowerCase().startsWith('the ')) guild = guild.slice(4);
  const guildTag = `[${guild.slice(0, 5)}]`;
  return `${guildTag} ${player.Name}`;
}

// Helper: build nickname from guild name and player name
function buildNickname(guildName, playerName) {
  // if no guild name (empty string, null or whitespace) -> use only player name
  if (!guildName || String(guildName).trim() === '') return String(playerName);

  // take first 5 characters exactly (keeps spaces if present)
  const firstFive = String(guildName).slice(0, 5);

  // construct nickname and ensure it doesn't exceed Discord's 32-char limit
  let nick = `[${firstFive}] ${playerName}`;
  return nick;
}


// --- SHARED REGISTER LOGIC START ---
async function executeRegisterLogic({ source, targetUser, gameName, executorMember }) {
  // source: can be Message or ChatInputCommandInteraction
  // targetUser: Discord User object
  // gameName: String
  // executorMember: GuildMember object (the person running the command)

  const isInteraction = source.isChatInputCommand?.();
  const targetId = targetUser.id;
  const executorId = executorMember.id;
  const isSelfRegister = targetId === executorId;
  const callerIsAdmin = isAdminOrMod(executorMember);

  // Helper wrappers to unify Message vs Interaction responses
  const doReply = async (payload) => {
    if (isInteraction) {
      if (source.deferred || source.replied) {
        return await source.editReply(payload);
      }
      // Reply first, then fetch the message explicitly
      await source.reply(payload);
      return await source.fetchReply();
    } else {
      return await source.reply(payload);
    }
  };
  
  const doReact = async (emoji) => {
    if (!isInteraction) {
      await source.react(emoji).catch(() => {});
    }
  };

  const HOW_TO_REGISTER_TEXT = 'Please use `!register + your game name` to register.\nFor example: `!register gamer123` if your game name is `gamer123`';

  // 1. Permission Check for registering others
  if (!isSelfRegister && !callerIsAdmin) {
    await doReact('⚠️');
    return doReply({
      embeds: [
        new EmbedBuilder()
          .setColor('#E74C3C')
          .setTitle('Register error')
          .setDescription('You need admin permission to register other users.\n\nPlease use `!register + your game name` to register.\nFor example: `!register gamer123`')
      ],
      flags: 64
    });
  }

  // 2. Validation
  if (!gameName || gameName.length > 16 || /[^A-Za-z0-9]/.test(gameName)) {
    await doReact('⚠️');
    return doReply({
      embeds: [
        new EmbedBuilder()
          .setColor('#E74C3C')
          .setTitle('Register error')
          .setDescription(HOW_TO_REGISTER_TEXT)
      ],
      flags: 64
    });
  }

  if (gameName.toLowerCase() === 'start') {
    await doReact('⚠️');
    return doReply({
      embeds: [
        new EmbedBuilder()
          .setColor('#E74C3C')
          .setTitle('Register error')
          .setDescription(`"\`${gameName}\`" is not your game name.\n\nPlease use \`!register + your game name\` to register.`)
      ],
      flags: 64
    });
  }

  // 3. DB Checks
  // A) Is target Discord already registered?
  const user_already_registered = checkDiscordRegistration(targetId);
  if (user_already_registered) {
    await doReact('⚠️');
    if (isSelfRegister) {
      if (user_already_registered.game_name.toLowerCase() === gameName.toLowerCase()) {
        return doReply({
          embeds: [new EmbedBuilder().setColor('#58B9FF').setTitle('Register info').setDescription(`You are already registered as **${user_already_registered.game_name}**, you don't need to do it again.`)]
        });
      }
      return doReply({
        embeds: [new EmbedBuilder().setColor('#E74C3C').setTitle('Register error').setDescription(`Your account is linked to **${user_already_registered.game_name}**. If you want to change it, use the command \`/Unregister\` first`)]
      });
    } else {
      return doReply({
        embeds: [new EmbedBuilder().setColor('#E74C3C').setTitle('Register error').setDescription(`The user <@${targetId}> is already registered as **${user_already_registered.game_name}**.`)]
      });
    }
  }

  // B) Is Game Name taken?
  const duplicate_game_name = checkGameRegistration(gameName);
  if (duplicate_game_name) {
    return doReply({
      embeds: [
        new EmbedBuilder()
          .setColor('#E74C3C')
          .setTitle('Register error')
          .setDescription(`${duplicate_game_name.game_name} is already registered by <@${duplicate_game_name.discord_id}>. ${callerIsAdmin ? '' : 'Contact a moderator if this is your character name.'}`)
      ],
      flags: 64
    });
  }

  // 4. API Lookup
  let apiJson;
  try {
    apiJson = await searchAlbion(gameName);
  } catch (err) {
    console.error('Albion search error', err);
    await doReact('⚠️');
    return doReply({
      embeds: [new EmbedBuilder().setColor('#E74C3C').setTitle('Register error').setDescription('Error contacting Albion API — try again later.')],
      flags: 64
    });
  }

  const players = apiJson?.players || [];
  const player = players.find((p) => p.Name.toLowerCase() === gameName.toLowerCase());

  if (!player) {
    await doReact('⚠️');
    return doReply({
      embeds: [
        new EmbedBuilder()
          .setColor('#E74C3C')
          .setTitle('Register error')
          .setDescription(`No players found with the name **${gameName}**`)
          .setFooter({ text: `Make sure the game name is correct and the account is on the Europe server.` })
      ],
      flags: 64
    });
  }

  // 5. Execution (DB & Discord)
  let extraInfo = '';
  const result = await addRegistrationToDB(targetId, player, executorId);

  if (result.success) {
    try {
      const guildMember = await source.guild.members.fetch(targetId);

      // Assign role
      try {
        if(VISITOR_ROLE_ID) await guildMember.roles.add(VISITOR_ROLE_ID, `Registered by ${executorMember.user.tag}`);
      } catch (err) {
        console.error('Failed to assign visitor role:', err);
      }

      // Set Nickname
      await guildMember.setNickname(buildNickname(player.GuildName, player.Name), `Registered by ${executorId}`);
    } catch (err) {
      if (err.code === RESTJSONErrorCodes.MissingPermissions) {
        extraInfo = `Failed to set nickname: ${err.message}`;
      } else {
        extraInfo = `Something went wrong though, check logs!`;
        console.error('Failed to set nickname:', err);
      }
    }

    // 6. Success Response & Button
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`quick_verify`)
        .setLabel('Open Verification Ticket')
        .setStyle(ButtonStyle.Success)
    );

    await doReact('✅');
    
    // Send the message
    const prompt = await doReply({
      embeds: [
        new EmbedBuilder()
          .setColor('#2ECC71')
          .setTitle('Registration Successful')
          .setDescription(`The character name \`${player.Name}\`${player.GuildName ? ` from \`${player.GuildName}\`` : ''} has been registered and linked to ${isSelfRegister ? 'your' : 'the'} account. ${extraInfo ? `(${extraInfo})` : ''}`)
      ],
      components: isSelfRegister ? [confirmRow] : [] // Only show ticket button if self-registering
    });

    // 7. Collector Logic for Ticket (Only if self-register)
    if (isSelfRegister) {
      // Safety check: ensure prompt is a valid Message object before creating collector
      if (!prompt) return;

      const collector = prompt.createMessageComponentCollector({
        filter: i => i.user.id === executorId,
        time: 30_000,
        max: 1
      });

      collector.on('collect', async interaction => {
        // Since we are creating a ticket which takes time, we defer/acknowledge
        await interaction.deferReply({ flags: 64 }).catch(err => console.error('Failed to defer reply:', err));

        // Disable button
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('quick_verify_progress')
            .setLabel('Opening ticket...')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
        );
        await prompt.edit({ components: [disabledRow] }).catch(err => console.error('Failed to disable button:', err));

        // Ticket Promise
        const ticketPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            waitingTickets.delete(interaction.user.id);
            reject(new Error('Ticket creation timeout after 15s'));
          }, 15000);
          waitingTickets.set(interaction.user.id, { resolve, reject, timeout });
        });

        // Trigger Ticket Bot
        const yeekCommandsChannel = await client.channels.fetch(YEEK_COMMANDS_CHANNEL);
        if (!yeekCommandsChannel) {
          const data = waitingTickets.get(interaction.user.id);
          if(data) { clearTimeout(data.timeout); data.reject(new Error('Commands channel not found')); waitingTickets.delete(interaction.user.id); }
          return;
        }

        await yeekCommandsChannel.send({ content: `$new <@${interaction.user.id}> (for quick create ticket)` });

        // Wait for result
        try {
          const channelId = await ticketPromise;
          await interaction.followUp({ content: `Ticket is created for you, check it here <#${channelId}>`, flags: 64 });
        } catch (error) {
          console.error('Failed to get ticket:', error);
          await interaction.followUp({ content: `Failed to get ticket information, if you don't see any tickets, open it here <#1383460322911715459>`, flags: 64 });
        }

        // Cleanup button
        await prompt.edit({ components: [] }).catch(() => {});
      });

      collector.on('end', async () => {
        // If expired and button still there, remove it
        if(prompt.editable) await prompt.edit({ components: [] }).catch(() => {});
      });
    }

  } else {
    // DB Failed
    await doReact('⚠️');
    await doReply({
      embeds: [new EmbedBuilder().setColor('#E74C3C').setTitle('Register error').setDescription(`Failed: ${result.error}`)],
      flags: 64
    });
  }
}
// --- SHARED REGISTER LOGIC END ---
// --- SHARED UNREGISTER LOGIC START ---
async function executeUnregisterLogic({ source, targetUser, executorMember }) {
  // source: Message or ChatInputCommandInteraction
  // targetUser: Discord User object
  // executorMember: GuildMember object (the person running the command)

  const isInteraction = source.isChatInputCommand?.();
  const targetId = targetUser.id;
  const executorId = executorMember.id;
  const isSelfUnregister = targetId === executorId;
  const callerIsAdmin = isAdminOrMod(executorMember);

  // Helper wrappers for responses
  const doReply = async (payload) => {
    if (isInteraction) {
      if (source.deferred || source.replied) {
        // editReply returns the Message object directly
        return await source.editReply(payload);
      }
      // 1. Send the reply (returns InteractionResponse or void)
      await source.reply(payload);
      // 2. Fetch the actual Message object explicitly
      // This is the "safe" way that fixes the "is not a function" error
      return await source.fetchReply(); 
    } else {
      // Message.reply returns the Message object directly
      return await source.reply(payload);
    }
  };

  // 1. Permission Check
  if (!isSelfUnregister && !callerIsAdmin) {
    return doReply({ content: 'You need admin permission to unregister other users.', flags: 64 });
  }

  // 2. DB Check
  const existing = findByDiscordId(targetId);
  if (!existing) {
    return doReply({ content: 'No registration found for that user.', flags: 64 });
  }

  // 3. Prepare Confirmation
  const uid = `${targetId}-${Date.now()}`;
  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirm-unregister-${uid}`)
      .setLabel('Confirm Unregister')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`cancel-unregister-${uid}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );

  const promptContent = `Are you sure you want to unregister **${existing.game_name}** from ${isSelfUnregister ? 'your' : `<@${targetId}>'s`} account? This will also purge all of ${isSelfUnregister ? 'your' : 'their'} roles!`;

  // Send Prompt
  const promptMessage = await doReply({
    content: promptContent,
    components: [confirmRow]
  });

  // Safety check: ensure we actually got a message back
  if (!promptMessage || typeof promptMessage.createMessageComponentCollector !== 'function') {
    console.error('Failed to retrieve prompt message object.');
    return; 
  }

  // 4. Create Collector
  const collector = promptMessage.createMessageComponentCollector({
    filter: i => i.user.id === executorId || isAdminOrMod(i.member),
    time: 30_000,
    max: 1
  });

  let acted = false;

  collector.on('collect', async interaction => {
    if (!interaction.customId.endsWith(uid)) return;

    acted = true;
    await interaction.deferUpdate().catch(() => {});

    if (interaction.customId.startsWith('confirm-unregister-')) {
      // --- PERFORM UNREGISTER ---
      removeRegistrationByDiscordId(targetId);

      try {
        const guildMember = await source.guild.members.fetch(targetId);
        // Purge roles
        try {
          await guildMember.roles.set([], `Unregistered by ${executorMember.user.tag}`);
        } catch (err) {
          console.error('Failed to purge roles on unregister:', err);
        }
        // Reset Nickname
        await guildMember.setNickname(null, `Unregistered by ${executorMember.user.tag}`);

        await promptMessage.edit({
          content: ``,
          embeds: [
            new EmbedBuilder()
              .setColor('#2ECC71')
              .setTitle('Unregistration Successful')
              .setDescription(`The name ${existing.game_name} is no longer linked to <@${targetId}>'s account.`)
          ],
          components: []
        }).catch(err => {
          console.error('Failed to edit reply:', err);
        });

      } catch (err) {
        if (err.code === RESTJSONErrorCodes.MissingPermissions) {
          await promptMessage.edit({
            content: ``,
            embeds: [
              new EmbedBuilder()
                .setColor('#2ECC71')
                .setTitle('Unregistration Successful')
                .setDescription(`The name ${existing.game_name} is no longer linked to <@${targetId}>'s account, but I was missing permissions to reset roles or nickname.`)
            ],
            components: []
          }).catch(() => {});
        } else {
          console.error('Unregister Execution Error:', err);
          await promptMessage.edit({
            content: '',
            embeds: [
              new EmbedBuilder()
                .setColor('#2ECC71')
                .setTitle('Unregistration Successful')
                .setDescription(`The name ${existing.game_name} is no longer linked to <@${targetId}>'s account (but couldn't update Discord member data).`)
            ],
            components: []
          }).catch(() => {});
        }
      }

    } else {
      // --- CANCELLED ---
      await promptMessage.edit({ content: 'Unregister cancelled.', components: [] }).catch(() => {});
    }
  });

  collector.on('end', () => {
    if (!acted) {
      promptMessage.edit({ content: 'Unregister confirmation timed out.', components: [] }).catch(() => {});
    }
  });
}
// --- SHARED UNREGISTER LOGIC END ---

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand()) {


    switch (interaction.commandName) {
      case 'weapons': {

        // Only allow in specific server
        if (![
          '992470319531040849', // jmboys
          '1247740449959968870' // brotherhood
        ].includes(interaction.guildId)) {
          await interaction.reply({ content: 'This bot is not allowed here.', flags: 64 });
          return;
        }

        // Check user role
        const allowedRoles = [
          '992470540717654037', // admin in jmboy's server
          '1265029315532161176', // cheiveman
          '1247895646929817730' // highlord
        ]; // role IDs
        const memberRoles = interaction.member.roles;

        if (!memberRoles.cache.some(role => allowedRoles.includes(role.id))) {
          await interaction.reply({ content: 'You don\'t have permission to use this command.', flags: 64 });
          return;
        }


        // Ephemeral confirmation
        await interaction.reply({ content: 'Wa are getting the intro and buttons ready.', flags: 64 });

        // Intro message (visible to all)
        await interaction.channel.send({
          content: `# Basic Weapons Guide  
This is a simple guide for different weapons and roles in the game. Nothing fancy, just a quick way to get an idea of how to use a weapon if you're new to it or not sure how it works.

This guide is made for kite and clap comp playstyle. If you're playing a different comp, the weapons might be used differently.

I made this based on my own experience and what I know about the weapons. There might be some mistakes or missing info, but I think it's a good starting point. You can check each weapon's guide by clicking the button and scrolling down.`
        });

        // Loop through roles and send weapon buttons per category
        for (const [role, weapons] of Object.entries(guides)) {
          const components = [];
          let row = new ActionRowBuilder();
          let count = 0;

          for (const weapon of Object.keys(weapons)) {
            if (count === 5) {
              components.push(row);
              row = new ActionRowBuilder();
              count = 0;
            }

            row.addComponents(
              new ButtonBuilder()
                .setCustomId(`${role}::${weapon}`)
                .setLabel(weapon)
                .setStyle(ButtonStyle.Primary)
            );

            count++;
          }

          if (count > 0) {
            components.push(row);
          }

          await interaction.channel.send({
            content: `## ${role}`,
            components
          });
        }

        break;
      }
      case 'roles': {

        // Check if command is used in the right server
        const allowedUserId = '760271416544722944'

        if (interaction.user.id !== allowedUserId) {
          return await interaction.reply({
            content: 'You are not allowed to use this command.',
            flags: 64
          });
        }

        const rolesMainEmbedText = `
  There are many roles you can play if we talking about zvz, this tool can give you a brief info and details about some of them

  This guide only covers the basics to get you started, it only meant for newcomers and beginers, each weapon has way more depth than what's written here
  `;

        const main_roles_guide_embed = new EmbedBuilder()
          .setTitle('Albion ZvZ Roles Basics')
          .setColor(0xF1C40F)
          .setDescription(rolesMainEmbedText);

        const open_roles_guide_button = new ButtonBuilder()
          .setCustomId('zvzRoles:open_roles_guide') // A unique identifier for the button
          .setLabel('Check Roles Info')           // The text displayed on the button
          .setStyle(ButtonStyle.Primary),  // The visual style of the button (e.g., Primary, Danger, Success, Secondary, Link)

              open_roles_guide_row = new ActionRowBuilder()
                .addComponents(open_roles_guide_button);

        await interaction.reply({ embeds: [main_roles_guide_embed], components: [open_roles_guide_row] });

    
        break;
      }
      case 'bandit': {
        const timeStr = interaction.options.getString('time');
        const show = interaction.options.getBoolean('show') || false;

        // Validate HH:MM
        const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(timeStr);
        if (!match) {
          return interaction.reply({ content: '❌ Please use format HH:MM (24h). Example: 13:22', flags: 64 });
        }

        const [, hh, mm] = match.map(Number);

        const now = new Date();
        const start = new Date(now);
        start.setHours(hh, mm, 0, 0);

        // earliest = +3.5h - 15m
        const earliest = new Date(start.getTime() + (3.5 * 60 - 15) * 60 * 1000);
        // latest = +6h - 15m
        const latest = new Date(start.getTime() + (6 * 60 - 15) * 60 * 1000);

        const fmt = (d) => d.toTimeString().slice(0, 5); // HH:MM

        const embed = new EmbedBuilder()
          .setColor(0xFEFE92)
          .setDescription(
            `If Bandit started at **${timeStr}**, the next one will be between **${fmt(earliest)}** and **${fmt(latest)}** at the latest.`
          )
          .setThumbnail('https://i.imgur.com/t4QMNiq.png');


        const dt = {
          embeds: [embed],
        }

        if (!show) {
          dt.flags = 64; // ephemeral
        }


        await interaction.reply(dt);
        break;
      }
      case 'comp_create':{
        // only allow if callers
        if (!interaction.member.roles.cache.some(role => CALLERS_ROLES_IDS.includes(role.id))) {
          return await interaction.reply({
            content: 'You are not allowed to use this command.',
            flags: 64
          });
        }

        // Only allow organizer or mods — keeper: anyone can create comps? We'll allow any user to create; organizer will be the invoker.
        const modal = new ModalBuilder()
          .setCustomId(`comp_create_modal-${interaction.user.id}-${Date.now()}`)
          .setTitle('Create comp');

        const slotsInput = new TextInputBuilder()
          .setCustomId('comp_slots')
          .setLabel('Slots (one role name per line)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder('Caller\nTank\nTank\nSupport\nDPS\nDPS\nHeal');

        const threadNameInput = new TextInputBuilder()
          .setCustomId('comp_thread_name')
          .setLabel('Thread name (optional)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('e.g. RZ cap');

        modal.addComponents(
          new ActionRowBuilder().addComponents(slotsInput),
          new ActionRowBuilder().addComponents(threadNameInput)
        );

        await interaction.showModal(modal);
        return;
      }
      case 'comp_assign':{
        // This command must be used inside a comp thread
        if (!interaction.channel || !interaction.channel.isThread()) {
          await interaction.reply({ content: 'This command must be used inside the comp thread.', flags: 64 });
          return;
        }

        // find comp by thread id
        const comp = getCompByThreadId(interaction.channel.id);
        if (!comp) {
          await interaction.reply({ content: 'This thread is not linked to a comp.', flags: 64 });
          return;
        }

        // parse options (slot and user) — comp_id option removed
        const slotNum = interaction.options.getInteger('slot', true);
        const user = interaction.options.getUser('user', true);

        // permission check: organizer or mod
        const isOrganizer = interaction.user.id === String(comp.organizer_id);
        if (!isOrganizer) {
          await interaction.reply({ content: 'Only the organizer can assign users.', flags: 64 });
          return;
        }

        // slot bounds
        if (slotNum < 1 || slotNum > comp.slots.length) {
          await interaction.reply({ content: 'Invalid role number.', flags: 64 });
          return;
        }

        const compId = comp.id;

        await runWithCompLock(compId, async () => {
          const fresh = getCompById(compId);
          const slots = fresh.slots;
         
          
          // if slot is already taken by same user -> unassign
          const targetSlot = slots[slotNum - 1];
          if (targetSlot.playerId === String(user.id)) {
            await interaction.reply({ content: 'User already signed to this role.', flags: 64 });
            return;
          }

          // if taken by someone else -> overwrite (organizer/mod allowed)
          if (targetSlot.playerId && targetSlot.playerId !== String(user.id)) {
            await interaction.reply({ content: `Role ${slotNum} already taken.`, flags: 64 });
            return;
          }

          // if empty -> assign
          if (!targetSlot.playerId) {
            // ensure user not already assigned in another slot
            const already = slots.find(s => s.playerId === String(user.id));
            if (already) {
              await interaction.reply({ content: `${user.tag} is already assigned to another role in this comp.`, flags: 64 });
              return;
            }
            targetSlot.playerId = String(user.id);
            // fetch guild member to get display name / nickname if available
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            targetSlot.playerName = member?.displayName || member?.nickname || user.tag;
            updateCompSlots(compId, slots);
            try {
              const channel = await client.channels.fetch(fresh.channel_id);
              const msg = await channel.messages.fetch(fresh.message_id);
              const body = buildCompMessageBody({ ...fresh, slots });
              await msg.edit(body);
            } catch (e) { /* ignore edit errors */ }
            await interaction.reply({ content: `Assigned ${user.tag} to role ${slotNum}.`, flags: 64 });
            return;
          }

        });

        break;
      }
      case 'comp_edit':{
        // Must be used inside a thread
        if (!interaction.channel || !interaction.channel.isThread()) {
          await interaction.reply({ content: 'This command must be used inside the comp thread.', flags: 64 });
          return;
        }

        // find comp by thread id
        const comp = getCompByThreadId(interaction.channel.id);
        if (!comp) {
          await interaction.reply({ content: 'This thread is not linked to a comp.', flags: 64 });
          return;
        }

        // Only organizer can edit
        const isSuperAdmin = String(interaction.user.id) === SUPER_ADMIN_ID;
        if (String(comp.organizer_id) !== String(interaction.user.id) && !isSuperAdmin) {
          await interaction.reply({ content: 'Only the organizer can edit this comp.', flags: 64 });
          return;
        }

        // Use shared helper function
        await showEditCompModal(interaction, comp);
        return;
      }
      case 'comp_check_voice': {

        await interaction.deferReply({ flags: 64 });

        // Must be used inside a comp thread
        if (!interaction.channel || !interaction.channel.isThread()) {
          await interaction.editReply({ content: 'This command must be used inside a comp thread.' });
          return;
        }

        // Find comp by thread id
        const comp = getCompByThreadId(interaction.channel.id);
        if (!comp) {
          await interaction.editReply({ content: 'This thread is not linked to a comp.' });
          return;
        }

        try {

          const voiceChannelId = interaction.member.voice?.channelId;

          if (!voiceChannelId) {
            await interaction.editReply({ content: 'You must be in a voice channel to use this command.' });
            return;
          }
    
          // Fetch the comp message directly using thread.id (which equals message.id)
          const parentChannel = interaction.channel.parent || await interaction.guild.channels.fetch(interaction.channel.parentId);
          const compMessage = await parentChannel.messages.fetch(interaction.channel.id);
    
          // Extract mentioned user IDs from the comp message
          const mentionedUserIds = new Set(compMessage.mentions.users.map(user => user.id));
    
          // Get signed up player IDs from comp slots
          const signedUpUserIds = new Set(
            comp.slots
              .filter(slot => slot.playerId)
              .map(slot => slot.playerId)
          );
    
          // Get current voice channel members (now from freshly fetched channel)
          const voiceStates = interaction.guild.voiceStates.cache.filter(
            vs => vs.channelId === voiceChannelId
          );

          const voiceMemberIds = new Set(voiceStates.map(vs => vs.id));

          // Find users in voice but not mentioned
          const inVoiceNotMentioned = [];
          voiceStates.forEach(vs => {
            if (!mentionedUserIds.has(vs.id) && !vs.member?.user.bot) {
              inVoiceNotMentioned.push(vs.id);
            }
          });
    
          // Find users signed up but not in voice
          const signedUpNotInVoice = [];
          for (const userId of signedUpUserIds) {
            if (!voiceMemberIds.has(userId)) {
              signedUpNotInVoice.push(userId);
            }
          }


          let response = '';
          if(inVoiceNotMentioned.length > 0 || signedUpNotInVoice.length > 0){
            response += `I checked voice chat and the people who signed up, here are the results:\n`
            if (inVoiceNotMentioned.length > 0) {
            // Not signed section
              response += '### Not signed\n';
              inVoiceNotMentioned.forEach(id => {
                response += `<:CF11:1408080636878524606> <@${id}>\n`;
              });
            }
    

            if (signedUpNotInVoice.length > 0) {
              response += '### Not in Voice\n';
              signedUpNotInVoice.forEach(id => {
                response += `<:CF11:1408080636878524606> <@${id}>\n`;
              });
            }

          } else {
            response += `I don't see any problems!`;
          }

          await interaction.editReply({ content: response });
    
        } catch (err) {
          console.error('Error checking voice members:', err);
          await interaction.editReply({ content: 'An error occurred while checking voice members.' });
        }
  
        break;
      }
      // START NEW COMMAND HANDLER
      case 'comp_members_addrole': {
        await interaction.deferReply({ flags: 64 }); // Ephemeral defer

        // 1. Thread & Comp Context Check
        if (!interaction.channel || !interaction.channel.isThread()) {
          await interaction.editReply({ content: 'This command must be used inside the comp thread.' });
          return;
        }

        const comp = getCompByThreadId(interaction.channel.id);
        if (!comp) {
          await interaction.editReply({ content: 'This thread is not linked to a comp.' });
          return;
        }

        // 2. Permission Check
        // Allow: Super Admin
        const isSuperAdmin = String(interaction.user.id) === SUPER_ADMIN_ID;

        if (!isSuperAdmin) {
          await interaction.editReply({ content: 'Only the super admin can use this command.' });
          return;
        }

        // 3. Get Role and Targets
        const targetRole = interaction.options.getRole('role', true);
        
        // Safety check: Don't allow giving dangerous permissions if logic fails elsewhere, 
        // though Discord handles hierarchy, it's good to be safe.
        if (targetRole.managed || targetRole.position >= interaction.guild.members.me.roles.highest.position) {
          await interaction.editReply({ content: `I cannot assign the role ${targetRole} because it is higher than or equal to my highest role.` });
          return;
        }

        const signedUpUserIds = new Set(
          comp.slots
            .filter(slot => slot.playerId)
            .map(slot => slot.playerId)
        );

        if (signedUpUserIds.size === 0) {
          await interaction.editReply({ content: 'No users are currently signed up in this comp.' });
          return;
        }

        // 4. Assign Roles
        let successCount = 0;
        let failCount = 0;
        const failedUsers = [];

        await interaction.editReply({ content: `Assigning ${targetRole} to ${signedUpUserIds.size} users...` });

        for (const userId of signedUpUserIds) {
          try {
            const member = await interaction.guild.members.fetch(userId).catch(() => null);
            if (!member) {
              failCount++;
              continue; // Member left guild
            }

            if (member.roles.cache.has(targetRole.id)) {
              // Already has role, count as success effectively
              successCount++;
            } else {
              await member.roles.add(targetRole, `Comp bulk add by ${interaction.user.tag}`);
              successCount++;
            }
          } catch (err) {
            console.error(`Failed to add role to ${userId}`, err);
            failCount++;
            failedUsers.push(`<@${userId}>`);
          }
        }

        // 5. Report Results
        let msg = `✅ **Operation Complete**\nRole ${targetRole} assigned to **${successCount}** users.`;
        
        if (failCount > 0) {
          msg += `\n⚠️ Failed to assign to **${failCount}** users.`;
          if (failedUsers.length > 0) {
            msg += `\nFailed users (check hierarchy or bots): ${failedUsers.join(', ')}`;
          }
        }

        await interaction.editReply({ content: msg });
        break;
      }

      case 'register': {
        // 1. Get Options
        const gameName = interaction.options.getString('ign', true); // 'ign' must match your slash command builder
        const targetUser = interaction.options.getUser('user') || interaction.user; // optional user for mods

        // 2. Defer immediately as API checks take time
        await interaction.deferReply();

        // 3. Execute Shared Logic
        await executeRegisterLogic({
          source: interaction,
          targetUser: targetUser,
          gameName: gameName,
          executorMember: interaction.member
        });
        break;
      }
      case 'unregister': {
        const targetUser = interaction.options.getUser('user') || interaction.user;

        // Note: We don't necessarily need to defer here if the logic sends a reply quickly, 
        // but deferring is safer for DB checks. The shared logic handles deferred states.
        // However, since we want a visible prompt (not ephemeral usually, or public), 
        // standard reply works. If you prefer ephemeral for unregistering, pass flags: 64 to doReply in shared logic.
        
        await executeUnregisterLogic({
          source: interaction,
          targetUser: targetUser,
          executorMember: interaction.member
        });
        break;
      }
    }


  } else if (interaction.isUserContextMenuCommand()) {
    if (interaction.commandName.startsWith('Give: ')){
      await interaction.deferReply({ flags: 64 }).catch(err => {
        console.error('Failed to defer reply:', err);
      });
        
      const member_roles_ids = [MEMBER_ROLE_ID, EOLMEMBER_ROLE_ID],
            intern_roles_ids = [INTERN_ROLE_ID, MEMBER_ROLE_ID],
            intern_and_member_roles_ids = [INTERN_ROLE_ID, MEMBER_ROLE_ID, EOLMEMBER_ROLE_ID];

      try {
        const member = await interaction.guild.members.fetch(interaction.targetId);
        switch(interaction.commandName){
          case 'Give: Member': {
            await member.roles.add(member_roles_ids, `Given member roles by ${interaction.user.tag}`).catch(err => {
              console.error(`Failed to give full member access roles to ${member.user.tag}:`, err);
            });
            await interaction.followUp({ content: `${member_roles_ids.map(id => `<@&${id}>`).join(' ')} roles are given to <@${member.id}>`, flags: 64 });
            return;
          }
          case 'Give: Intern': {
            await member.roles.add(intern_roles_ids, `Given Intern roles by ${interaction.user.tag}`).catch(err => {
              console.error(`Failed to give Intern roles to ${member.user.tag}:`, err);
            });
            await interaction.followUp({ content: `${intern_roles_ids.map(id => `<@&${id}>`).join(' ')} roles are given to <@${member.id}>`, flags: 64 });
            return;
          }
          case 'Give: Intern Member': {
            await member.roles.add(intern_and_member_roles_ids, `Given Intern Member roles by ${interaction.user.tag}`).catch(err => {
              console.error(`Failed to give Member + Intern roles to ${member.user.tag}:`, err);
            });
            await interaction.followUp({ content: `${intern_and_member_roles_ids.map(id => `<@&${id}>`).join(' ')} roles are given to <@${member.id}>`, flags: 64 });
            return;
          }
          default: {
            await interaction.followUp({ content: `Unrecognized command.`, flags: 64 });
            return;
          }
        }
      } catch (err) {
        console.error(err);
        await interaction.followUp({ content: '❌ Failed to give roles.', flags: 64 });
      }
      return;
    } else if (interaction.commandName === 'Update name') {

      const modal = new ModalBuilder()
        .setCustomId(`renameModal:${interaction.targetId}`)
        .setTitle('Enter Albion nickname');

      const input = new TextInputBuilder()
        .setCustomId('nicknameInput')
        .setLabel('Player nickname')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const row = new ActionRowBuilder().addComponents(input);
      modal.addComponents(row);
      return interaction.showModal(modal);

    } else if (interaction.commandName === 'Internal Note') {

      // Optional: restrict who can open the modal. Example: only members with a role ID
      // const member = interaction.member;
      // if (!member.roles.cache.has('STAFF_ROLE_ID')) return interaction.reply({ content: 'You do not have permission.', flags: 64 });

      const targetUser = interaction.targetUser;
      const existingNote = getInternNote(targetUser.id) || '';

      const modal = new ModalBuilder()
        .setCustomId(`internal_notes_modal:${targetUser.id}`)
        .setTitle(`Intern Note — ${targetUser.username}`);

      const input = new TextInputBuilder()
        .setCustomId('internal_note_input')
        .setLabel('Note (clear to remove)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Write a short note about this intern')
        .setRequired(false);

      if (existingNote) input.setValue(existingNote);

      const row = new ActionRowBuilder().addComponents(input);
      modal.addComponents(row);

      await interaction.showModal(modal);

    }
  } else if (interaction.isMessageContextMenuCommand()) {
     
    if (interaction.commandName === 'Check Comp') {
    // Only allow if user has caller role
      if (!interaction.member.roles.cache.some(role => CALLERS_ROLES_IDS.includes(role.id))) {
        return await interaction.reply({
          content: 'You are not allowed to use this command.',
          flags: 64
        });
      }

      const targetMessage = interaction.targetMessage;
    
      // Try to find comp by message_id
      const comp = db.prepare('SELECT * FROM comps WHERE message_id = ?').get(targetMessage.id);
    
      if (!comp) {
        return await interaction.reply({
          content: 'This message is not a comp.',
          flags: 64
        });
      }

      // Show modal with pre-filled comp data
      const modal = new ModalBuilder()
        .setCustomId(`comp_check_modal-${interaction.user.id}-${Date.now()}`)
        .setTitle('Preview the comp');

      const slotsText = comp.raw_input

      const slotsInput = new TextInputBuilder()
        .setCustomId('comp_slots')
        .setLabel('Preview only')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setValue(slotsText)
        .setPlaceholder('Changes will not be saved');

      modal.addComponents(
        new ActionRowBuilder().addComponents(slotsInput),
      );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.commandName === 'Edit Comp') {
      // Only allow if user has caller role
      if (!interaction.member.roles.cache.some(role => CALLERS_ROLES_IDS.includes(role.id))) {
        return await interaction.reply({
          content: 'You are not allowed to use this command.',
          flags: 64
        });
      }

      const targetMessage = interaction.targetMessage;
    
      // Find comp by message_id
      const comp = db.prepare('SELECT * FROM comps WHERE message_id = ?').get(targetMessage.id);
    
      if (!comp) {
        return await interaction.reply({
          content: 'This message is not a comp.',
          flags: 64
        });
      }

      // Parse slots_json to get full comp object
      const fullComp = {
        ...comp,
        slots: JSON.parse(comp.slots_json),
        raw_input: comp.raw_input || null
      };

      // Only organizer can edit
      const isSuperAdmin = String(interaction.user.id) === SUPER_ADMIN_ID;
      if (String(fullComp.organizer_id) !== String(interaction.user.id) && !isSuperAdmin) {
        return await interaction.reply({
          content: 'Only the organizer can edit this comp.',
          flags: 64
        });
      }

      // Use shared helper function
      await showEditCompModal(interaction, fullComp);
      return;
    }

  } else if (interaction.isButton()) {

    // weapons guide buttons contains "::" so we find them here xxx
    if (interaction.customId.includes('::')) {
      const [category, weapon] = interaction.customId.split('::');
      const path = guides[category]?.[weapon];

      if (!path) {
        return interaction.reply({ content: 'Guide not found.', flags: 64 });
      }

      await interaction.deferReply({ flags: 64 });

      try {
        const guideText = await readFile(new URL(`./guides/${path}`, import.meta.url), 'utf8');
        // await interaction.reply({ content: guideText, flags: 64 });
        


        // get parts of the guide
        const parts_of_guide = insertCommon(guideText).split('---').map(e => e.trim()).filter(Boolean),
              embeds = parts_of_guide.map(raw_text => {

                let embed_title = null,
                    embed_text = raw_text;

                if (raw_text.startsWith('^')) {
                  const newlineIndex = raw_text.indexOf('\n');
                  embed_title = raw_text.slice(1, newlineIndex).trim();
                  embed_text = raw_text.slice(newlineIndex + 1).trimStart();
                }

                const embed = new EmbedBuilder()
                  .setColor(0xE67E22)
                  .setDescription(embed_text)

                if(embed_title){
                  embed.setTitle(embed_title || weapon)
                }

                return embed
              })



        const askButton = new ButtonBuilder()
          .setCustomId(`ask:${weapon}`)
          .setLabel('Have questions or feedback?')
          .setStyle(ButtonStyle.Primary)

        const row = new ActionRowBuilder().addComponents(askButton);

        await interaction.editReply({
          embeds: embeds,
          components: [row],
          flags: 64
        });

        // Get nickname or fallback to username/tag
        const displayName = interaction.member?.displayName || interaction.member?.nickname || interaction.user.tag;

        // Log the event
        if (interaction.user.id !== '760271416544722944') {
          console.log(`${weapon} guide requested by: ${displayName} (ID: ${interaction.user.id})`);
          recordStat(interaction.user.id, weapon, displayName);
        }

      } catch (err) {
        console.error(err);
        await interaction.editReply({ content: 'Error loading guide.', flags: 64 });
      }

    } else if (interaction.customId.startsWith('ask:')) {
      const weapon = interaction.customId.split(':')[1]; // lifecurse

      // Build modal
      const modal = new ModalBuilder()
        .setCustomId(`modal:ask:${weapon}`) // pass weapon forward
        .setTitle(`About ${weapon}`);

      const questionInput = new TextInputBuilder()
        .setCustomId('question_input')
        .setLabel("What's on your mind?")
        .setStyle(TextInputStyle.Paragraph) // multi-line
        .setRequired(true)
        .setMaxLength(1000);

      const row = new ActionRowBuilder().addComponents(questionInput);
      modal.addComponents(row);

      // Show the modal
      await interaction.showModal(modal);
      return;
    } else if (interaction.customId.startsWith('confirmRename:')) {

      const [, userId, encodedName] = interaction.customId.split(':');
      const newName = decodeURIComponent(encodedName);

      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (!member)
        return interaction.reply({ content: '❌ Could not fetch that user.', flags: 64 });

      await member.setNickname(newName).catch((err) =>
        interaction.reply({ content: `Error: ${err.message}`, flags: 64 })
      );

      const successEmbed = new EmbedBuilder()
        .setColor(0x2ecc71) // green = success
        .setTitle('Update Successful')
        .setDescription(`**${member.user.tag}** has been renamed to **${newName}**.`)
        .setFooter({ text: `Renamed by ${interaction.user.tag}` });

      await interaction.update({
        embeds: [successEmbed], // replaces old embed and fields
        components: []          // clears the old buttons
      });

    } else if (interaction.customId.startsWith('zvzRoles')) {

      // Special button: open the root "Roles Guide" panel
      if (interaction.customId === 'zvzRoles:open_roles_guide') {
        const rootEmbed = buildMessage(startedPanelObject, []);
        return await interaction.reply(rootEmbed);
      }

      // Example: "open:Tank>Hammer>One-Handed Hammer"
      const [action, rawPath] = interaction.customId.split(':');
      const path = rawPath ? rawPath.split('>') : [];

      // Get the node at the given path
      const currentNode = getNode(path, rolesTree);

      // If node doesn’t exist anymore → notify user
      if (!currentNode) {
        return await interaction.reply({
          content: 'This guide section no longer exists.',
          flags: 64 // ephemeral
        });
      }

      // Handle actions
      if (action === 'zvzRoles_open') {
        // Update the message with the selected node’s content
        await interaction.update(buildMessage(currentNode, path));
      } else if (action === 'zvzRoles_back') {
        // Parent path = one level up
        const parentPath = path.slice(0, -1);

        // Get parent node (null if we’re already at the root)
        const parentNode = getNode(parentPath, rolesTree);

        // If parent exists → show it, otherwise reset to root panel
        if (parentNode) {
          await interaction.update(buildMessage(parentNode, parentPath));
        } else {
          await interaction.update(buildMessage(startedPanelObject, []));
        }
      }


    }

  } else if (interaction.isModalSubmit()){
    if (interaction.customId && interaction.customId.startsWith('modal:ask:')) {
      const parts = interaction.customId.split(':');
      const weapon = parts[2] || 'unknown-weapon';
      const question = interaction.fields.getTextInputValue('question_input');

      // Build the embed to send to you
      const infoEmbed = new EmbedBuilder()
        .setColor(0xE67E22)
        .setTitle(weapon)
        .setDescription(question.length > 1024 ? question.slice(0, 1018) + '…' : question)
        .addFields(
          { name: 'From', value: `${interaction.member?.nickname || '—'} (${interaction.user.tag})`, inline: true },
          { name: 'User ID', value: `${interaction.user.id}`, inline: true },
          { name: 'Mention', value: `<@${interaction.user.id}>`, inline: true },
        )
        .setTimestamp();

      infoEmbed.setAuthor({
        name: `${interaction.member?.nickname || interaction.user.tag}`,
        iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 256 })
      });

      // IDs to replace later
      const RECIPIENT_ID = '760271416544722944';
      const FALLBACK_CHANNEL_ID = '1322532853178695730';

      // Confirm to the submitter (ephemeral)
      await interaction.reply({ content: 'Your input was sent.', flags: 64 });

      // Try to DM the recipient
      try {
        const user = await interaction.client.users.fetch(RECIPIENT_ID);
        await user.send({ embeds: [infoEmbed] });
        console.log(`Question DM sent to ${RECIPIENT_ID} from ${interaction.user.tag}`);
      } catch (dmErr) {
        console.error('Failed to DM recipient — falling back to channel:', dmErr);
        // Fallback: send to channel
        try {
          const channel = await interaction.client.channels.fetch(FALLBACK_CHANNEL_ID);
          if (channel && channel.isTextBased()) {
            await channel.send({ embeds: [infoEmbed] });
            console.log('Question sent to fallback channel.');
          } else {
            console.error('Fallback channel not found or not text-based.');
          }
        } catch (chanErr) {
          console.error('Failed to send to fallback channel as well:', chanErr);
        }
      }

      return;
    }

    if (interaction.customId && interaction.customId.startsWith('internal_notes_modal:')) {
      await interaction.deferReply({ flags: 64 });

      const targetId = interaction.customId.split(':')[1];
      const note = interaction.fields.getTextInputValue('internal_note_input')?.trim() || '';

      const result = upsertInternNote(targetId, note);

      if (result.action === 'deleted') {
        await interaction.editReply({ content: 'Note cleared and removed.' });
      } else if (result.action === 'updated') {
        await interaction.editReply({ content: 'Note updated.' });
      } else {
        await interaction.editReply({ content: 'Note created.' });
      }

    }

    // handle comp_create modal submit
    if (interaction.customId && interaction.customId.startsWith('comp_create_modal-')) {
      // Acknowledge the interaction immediately to avoid "Unknown interaction" while doing slow work.
      // We use ephemeral so only the command user sees the ack.
      await interaction.deferReply({ flags: 64 });

      try {
        // Inside comp_create_modal submit:
        const slotsText = interaction.fields.getTextInputValue('comp_slots').trim();
        const allLines = slotsText.split(/\r?\n/).map(s => s.trim());

        // Keep existing logic - only roles go into slotsArray
        const slotsArray = [];
        allLines.forEach((line) => {
          if (!line || line.startsWith('>')) return; // skip empty and comments
          slotsArray.push({
            roleName: line,
            playerId: null,
            playerName: null,
          });
        });

        if (slotsArray.length === 0) {
          await interaction.editReply({ content: 'No slots provided.' });
          return;
        }

        if (slotsArray.length > 60) {
          await interaction.editReply({ content: 'Too many slots. Max 60.' });
          return;
        }

        // Create comp with both arrays
        const compId = createCompRecord({
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          organizerId: String(interaction.user.id),
          slotsArray,      // only roles (existing behavior)
          rawInput: slotsText // full input with comments
        });

        // read optional thread name from modal (trim and limit to 100 chars)
        const threadNameRaw = (interaction.fields.getTextInputValue('comp_thread_name') || '').trim();
        const threadNameDefault = `comp-${compId}`;
        const threadNameFinal = threadNameRaw ? threadNameRaw.slice(0, 100) : threadNameDefault;

        // Build message body
        const comp = getCompById(compId);
        const body = buildCompMessageBody(comp);

        // post message and create thread
        try {
          const channel = await client.channels.fetch(comp.channel_id);

          const posted = await channel.send(body);

          // start a thread
          const thread = await posted.startThread({ name: threadNameFinal, autoArchiveDuration: 1440 });

          // update DB with message_id/thread_id
          updateCompRow(compId, { message_id: posted.id, thread_id: thread.id });

          // send a sign-up guide embed as the first message inside the thread
          const guideEmbed = new EmbedBuilder()
            .setDescription(
              `### Comp posted by:
<@${comp.organizer_id}>
### How to sign up:
- Type the role number to take the role
- Use negative role number to unsign (example: -2 to unsign from role 2)
- The organizer can use \`/comp_assign\` to sign anyone
- The organizer can use -N to unsign anyone`
            )
            .setColor(0x3498db);

          try {
            await thread.send({ embeds: [guideEmbed] });
          } catch (err) {
            console.error('Failed to send signup guide embed in thread:', err);
            // not fatal for the interaction response, continue
          }

          // We deferred earlier, so edit the reply to show success.
          await interaction.editReply({ content: `Comp created: #${compId}` });
        } catch (err) {
          console.error('Failed to post comp message/thread:', err);
          // Edit the deferred reply to communicate the failure
          await interaction.editReply({ content: 'Failed to post comp message. Try again later.' });
        }

        return;
      } catch (err) {
        console.error('Unhandled error in comp creation flow:', err);
        // if we deferred, edit; otherwise try to reply
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: 'An error occurred while creating the comp.' });
        } else {
          await interaction.reply({ content: 'An error occurred while creating the comp.', flags: 64 });
        }
        return;
      }
    }


    // ---- Handle edit_comp modal submit ----
    if (interaction.customId && interaction.customId.startsWith('edit_comp_modal-')) {

      // customId format: edit_comp_modal-<compId>-<userId>-<ts>
      const parts = interaction.customId.split('-');
      const compId = parseInt(parts[1], 10);
      // sanity
      if (!compId) {
        await interaction.reply({ content: 'Invalid comp id in modal.', flags: 64 });
        return;
      }

      // permission check again
      const comp = getCompById(compId);
      if (!comp) {
        await interaction.reply({ content: 'Comp not found.', flags: 64 });
        return;
      }

      const isSuperAdmin = String(interaction.user.id) === SUPER_ADMIN_ID;
      if (String(comp.organizer_id) !== String(interaction.user.id) && !isSuperAdmin) {
        await interaction.reply({ content: 'Only the organizer can edit this comp.', flags: 64 });
        return;
      }

      // Defer early so we avoid "Unknown interaction" during the edit work
      await interaction.deferReply({ flags: 64 });

      // parse new values
      const slotsText = interaction.fields.getTextInputValue('comp_slots').trim();
      const allLines = slotsText.split(/\r?\n/).map(s => s.trim());

      // Extract only roles (skip comments and empty lines)
      const newSlots = [];
      allLines.forEach((line) => {
        if (!line || line.startsWith('>')) return; // skip empty and comments
        newSlots.push({
          roleName: line,
          playerId: null,
          playerName: null
        });
      });

      if (newSlots.length === 0) {
        await interaction.editReply({ content: 'No slots provided.' });
        return;
      }
      if (newSlots.length > 60) {
        await interaction.editReply({ content: 'Too many slots. Max 60.' });
        return;
      }

      // remap signups by role name (preserve original signup order by scanning old slots in order)
      const oldSlots = comp.slots || [];
      const signups = [];
      for (let i = 0; i < oldSlots.length; i++) {
        const s = oldSlots[i];
        if (s.playerId) {
          signups.push({ playerId: s.playerId, playerName: s.playerName || `<@${s.playerId}>`, oldRole: s.roleName });
        }
      }

      const unassigned = [];
      // for each signup in order, try to find first matching role in newSlots
      for (const su of signups) {
        let placed = false;
        for (let j = 0; j < newSlots.length; j++) {
          if (newSlots[j].roleName === su.oldRole && !newSlots[j].playerId) {
            newSlots[j].playerId = su.playerId;
            newSlots[j].playerName = su.playerName;
            placed = true;
            break;
          }
        }
        if (!placed) {
          // keep playerId so we can mention them in the thread
          unassigned.push({ playerId: su.playerId, userName: su.playerName, oldRole: su.oldRole });
        }
      }

      // Save new slots AND raw_input using the helper
      updateCompRow(compId, {
        slots_json: JSON.stringify(newSlots),
        raw_input: slotsText
      });

      // Update the comp message body and append Unassigned if any
      const refreshed = getCompById(compId);

      const newBody = buildCompMessageBody(refreshed);
      try {
        const channel = await client.channels.fetch(refreshed.channel_id);
        const postedMsg = await channel.messages.fetch(refreshed.message_id);
        await postedMsg.edit(newBody);

        // If we have unassigned users after edit, post a thread message to notify organizer & users
        if (unassigned.length > 0 && refreshed.thread_id) {
          try {
            const thread = await client.channels.fetch(refreshed.thread_id);
            const lines = unassigned.map(u => `- ${u.playerId ? `<@${u.playerId}>` : u.userName} (was: ${u.oldRole})`);
            await thread.send({
              content: `Some signups could not be preserved after the edit and were unassigned:\n${lines.join('\n')}`
            });
          } catch (err) {
            console.error('Failed to post unassigned notice in thread:', err);
          }
        }
      } catch (e) {
        console.error('Failed to update comp message after edit:', e);
      }

      // reply to organizer
      await interaction.editReply({ content: `Comp #${compId} updated. ${unassigned.length ? `${unassigned.length} user(s) unassigned.` : 'All signups preserved.'}` });
      return;
    }

    if (interaction.customId && interaction.customId.startsWith('comp_check_modal-')) {
      await interaction.reply({
        content: 'You closed the modal.',
        ephemeral: true
      });
    }

    if (!interaction.customId.startsWith('renameModal:')) return;

    const userId = interaction.customId.split(':')[1];
    const nickname = interaction.fields.getTextInputValue('nicknameInput');

    await interaction.deferReply({ flags: 64 });

    const players = await fetchAlbionPlayers(nickname);
    if (!players.length) {
      return interaction.editReply(`❌ No players found for **${nickname}**`);
    }

    // If multiple matches → show dropdown
    if (players.length > 1) {
      const options = players.slice(0, 25).map((p) => ({
        label: formatAlbionName(p).slice(0, 100),
        description: `Guild: ${p.GuildName || 'None'} | Fame: ${p.KillFame || 0}`,
        value: `${userId}:${p.Id}`
      }));

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('selectAlbionPlayer')
        .setPlaceholder('Select the correct player')
        .addOptions(options);

      const row = new ActionRowBuilder().addComponents(selectMenu);
      return interaction.editReply({
        content: `Found **${players.length}** matches for “${nickname}”. Select the correct player:`,
        components: [row]
      });
    }

    // If exactly one player → show confirm
    const player = players[0];
    const newName = formatAlbionName(player);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`confirmRename:${userId}:${encodeURIComponent(newName)}`)
        .setLabel(`Rename to "${newName}"`)
        .setStyle(ButtonStyle.Success)
    );



    const embed = new EmbedBuilder()
      .setColor(0x00ff99)
      .setTitle('Confirm Rename')
      .setDescription('Verify the name below before confirming the change.')
      .addFields(
        { name: 'Current Nickname', value: interaction.guild.members.cache.get(userId)?.displayName || 'Unknown', inline: true },
        { name: 'New Nickname', value: newName, inline: true }
      )
      .setFooter({ text: 'Press the button below to apply the new name.' });

    await interaction.editReply({
      embeds: [embed],
      components: [row]
    });


  } else if (interaction.isStringSelectMenu()){
    if (interaction.customId !== 'selectAlbionPlayer') return;

    const [userId, playerId] = interaction.values[0].split(':');
    await interaction.deferUpdate();

    const res = await fetch(
      `https://gameinfo-ams.albiononline.com/api/gameinfo/players/${playerId}`
    );
    const player = await res.json();
    const newName = formatAlbionName(player);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`confirmRename:${userId}:${encodeURIComponent(newName)}`)
        .setLabel(`Confirm Rename`)
        .setStyle(ButtonStyle.Success)
    );


    const guild = interaction.guild;
    let member = guild.members.cache.get(userId);
    if (!member) member = await guild.members.fetch(userId).catch(() => null);

    const oldName = member?.displayName || 'Unknown';

    const confirmEmbed = new EmbedBuilder()
      .setColor(0x00ff99)
      .setTitle('Confirm Rename')
      .setDescription('Please confirm the new nickname before applying it.')
      .addFields(
        { name: 'Current Nickname', value: oldName, inline: true },
        { name: 'New Nickname', value: newName, inline: true }
      )
      .setFooter({ text: 'Press Confirm to rename this user.' });

    // replace old embeds/content with this one
    await interaction.editReply({
      embeds: [confirmEmbed], // replaces old content/embed
      components: [row],
      content: null            // clear any leftover text content
    });

  }


});

const ticketCategoryId = process.env.TICKETS_CATEGORY_ID;

const waitingTickets = new Map();
client.on('channelCreate', async (channel) => {
  if (!channel.isTextBased() || channel.type !== ChannelType.GuildText) return;

  if (channel.parentId !== ticketCategoryId) return;
  if (!channel.name.startsWith('ticket-')) return;

  setTimeout(async () => {
    try {
      if (!channel.permissionsFor(channel.guild.members.me).has('SendMessages')) return;

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('Checklist')
        .setDescription(`
### Answer these questions:
1. Do you understand English?
2. Do you agree to play **only** for Martlock?
3. Can you join voice chat to hear calls? (no need to talk)
### Send 2 screenshots:
1. Character stats
2. Faction warfare overview **(your name should be visible)**
`)
        .setImage('https://i.imgur.com/ZVoVlcC.png')
        .setFooter(
          { text: `After that, we'll get back to you as soon as possible. Thanks!` }
        )



    
      await channel.send({
        embeds: [
          embed
        ]
      });

    } catch (err) {
      console.error(`❌ Failed to send follow-up message in ${channel.name}:`, err);
    }
  }, 4000);

  // check for quick verify
  for (const [userId, data] of waitingTickets) {
    if (!channel.permissionOverwrites.cache.has(userId)) continue;
    
    clearTimeout(data.timeout);
    data.resolve(channel.id);
    waitingTickets.delete(userId);
    break;
  }

});


const ALLOWED_COMMANDS = new Set(['register','unregister','registerinfo','link','kb', 'modkb', 'registerhelp']),
      VISITOR_ROLE_ID = process.env.VISITOR_ROLE_ID,
      MESSAGE_USE_IN_ALLOWED_CHANNELS = `Please use register commands in the https://discord.com/channels/1247740449959968870/1247939976667205633 or https://discord.com/channels/1247740449959968870/1275402208845893644 channel.`;


client.on('messageCreate', async (message) => {

  if (message.author?.bot) return;
  const raw = message.content;
  if (!raw || raw.charCodeAt(0) !== 33) return; // '!' === 33
  if (raw.length < 3) return;

  const firstSpace = raw.indexOf(' ');
  const cmd = (firstSpace === -1 ? raw.slice(1) : raw.slice(1, firstSpace)).toLowerCase();

  if (!ALLOWED_COMMANDS.has(cmd)) return;

  // Check channel restriction unless admin
  const callerIsAdmin = isAdminOrMod(message.member);
  
  if (!callerIsAdmin && !REGISTER_CHANNEL_IDS.includes(message.channel.id)) {
    message.reply(MESSAGE_USE_IN_ALLOWED_CHANNELS);
    return;
  }

  // ---- REGISTERHELP ----
  // place this right after `const cmd = ...` and before channel restriction checks
  if (cmd === 'registerhelp') {
    const helpEmbed = new EmbedBuilder()
      .setTitle('Register Related Commands')
      .setColor(0x3498db)
      .setDescription('Short explanations and usage for registration-related commands.')
      .addFields(
        { name: '!register <name>',
          value: 'Register an Albion character to a Discord account (or to a mentioned user). Exact name match required. Example: `!register Tweezys`',
          inline: false },
        { name: '!unregister', 
          value: 'Remove a registration. This will un-link the character name and purge roles from the user.',
          inline: false },
        { name: '!registerinfo <game_name>  or  !registerinfo @User', 
          value: 'Show registration details for a game name or a Discord user.',
          inline: false },
        { name: '!kb <game_name>  or  !kb @User', 
          value: 'Show game stats of registered users.',
          inline: false },
        { name: '!register @User <name>  or  !link @User <name>',
          value: 'Admin-only. Link a game name to a Discord user. !link does not change name of the user',
          inline: false },
        { name: '!unregister @User',
          value: 'Admin-only. un-link a game name from a Discord user and purge its roles',
          inline: false },
        { name: '!modkb <game_name>  or  !modkb @User',
          value: 'Admin-only. Show game stats of any albion player.',
          inline: false }
      )

    await message.reply({ embeds: [helpEmbed] });
    return;
  }


  // ---- UNREGISTER ----
  if (cmd === 'unregister') {
    const parts = message.content.trim().split(/\s+/).slice(1);
    let targetId = message.author.id;

    // Check if there are arguments
    if (parts.length > 0) {
      // Regex to ensure the argument is explicitly a mention <@ID>
      const mentionRegex = /^<@!?(\d+)>$/;
      const match = parts[0].match(mentionRegex);

      if (match) {
        // If the first word is a mention, use that ID
        targetId = match[1];
      } else {
        // If there is text but it's not a mention (e.g. "!unregister junk"), show usage
        return message.reply('Usage: `!unregister` or `!unregister @User`');
      }
    }

    const targetUser = await client.users.fetch(targetId).catch(() => null);
    if (!targetUser) return message.reply('User not found.');

    await executeUnregisterLogic({
      source: message,
      targetUser: targetUser,
      executorMember: message.member
    });
    return;
  }

  // ---- REGISTER ----
  if (cmd === 'register') {
    // Parse args
    const { targetId, nameArg } = parseRegisterArgs(message);
    const targetUser = await client.users.fetch(targetId).catch(() => null);

    if (!targetUser) {
      return message.reply('Could not find that user.');
    }
    
    // Execute Shared Logic
    // Note: We don't defer here because message commands don't require it, 
    // but the shared logic handles message.reply vs interaction.editReply automatically.
    await executeRegisterLogic({
      source: message,
      targetUser: targetUser,
      gameName: nameArg, // The function checks if nameArg is valid/null
      executorMember: message.member
    });
    return; 
  }

  // ---- REGISTERINFO ----
  if (cmd === 'registerinfo') {
  // guard: channel/permission
    const callerIsAdmin = isAdminOrMod(message.member);
    if (!callerIsAdmin && !REGISTER_CHANNEL_IDS.includes(message.channel.id)) {
      return message.reply(MESSAGE_USE_IN_ALLOWED_CHANNELS);
    }

    // parse args
    const mention = message.mentions.users.first();
    const parts = message.content.trim().split(/\s+/).slice(1);
    if (mention) parts.shift(); // remove mention token
    const nameArg = parts.join(' ').trim();

    // Helper to build embed from a registration DB row
    const buildEmbedFromRow = (row) => {
      const embed = new EmbedBuilder()
        .setTitle('Registration info')
        .addFields(
          { name: 'Game name', value: `${row.game_name}`, inline: false },
          { name: 'Discord', value: `<@${row.discord_id}>`, inline: false },
          { name: 'Discord ID', value: `${row.discord_id}`, inline: false },
          { name: 'Added by', value: `<@${row.registered_by}>`, inline: false },
          { name: 'Registered at', value: `${row.registered_at}`, inline: false }
        )
      return embed;
    };

    // Lookup by mention first
    if (mention) {
      const row = findByDiscordId(mention.id);
      if (!row) {
        return message.reply(`${mention} is not linked to any game name.`);
      }
      const embed = buildEmbedFromRow(row);
      return message.reply({ embeds: [embed] });
    }

    // Otherwise lookup by game name (case-insensitive)
    if (!nameArg) {
      return message.reply('Usage: `!registerinfo @discorduser` or `!registerinfo game_name`.');
    }

    const rowByName = findByGameName(nameArg);
    if (!rowByName) {
      return message.reply(`The game name **${nameArg}** is not linked to any Discord account in this server.`);
    }

    const embed = buildEmbedFromRow(rowByName);
    return message.reply({ embeds: [embed] });
  }

  // ---- LINK (mods/admins only): !link @user game_name ----
  if (cmd === 'link') {

    // Only mods/admins can use this command
    if (!isAdminOrMod(message.member)) {
      return message.reply('You need mod or admin permission to use this command.');
    }
    
    const mention = message.mentions.users.first();
    if (!mention) {
      return message.reply('Usage: `!link @user game_name` (you must mention a user).');
    }

    // Extract the game name (remove the mention token)
    const parts = message.content.trim().split(/\s+/).slice(1);
    parts.shift(); // remove the mention
    const nameArg = parts.join(' ').trim();
    if (!nameArg) {
      return message.reply('Usage: `!link @user game_name` (missing game name).');
    }

    const targetId = mention.id;
    // 1) Check if the target user is already registered
    const existingTarget = findByDiscordId(targetId);
    if (existingTarget) {
      return message.reply(
        `<@${targetId}> is already registered as **${existingTarget.game_name}**. Use \`!unregister @user\` first if you want to change it.`
      );
    }

    // 2) Check if the game name is already registered by someone else
    const duplicate = findByGameName(nameArg);
    if (duplicate) {
      return message.reply(
        `The character name **${nameArg}** is already registered to <@${duplicate.discord_id}>. If this is incorrect, unregister the other account first.`
      );
    }

    // 3) Verify game name exists on Albion API (case-insensitive exact match)
    let apiJson;
    try {
      apiJson = await searchAlbion(nameArg);
    } catch (err) {
      console.error('Albion search error (link):', err);
      return message.reply('Error contacting Albion API — try again later.');
    }

    const players = apiJson?.players || [];
    if (!players.length) {
      return message.reply(`No players found with the name "${nameArg}".`);
    }

    const player = players.find((p) => p.Name.toLowerCase() === nameArg.toLowerCase());
    if (!player) {
      return message.reply(
        `No exact match found for "${nameArg}". Please double-check the spelling or use the full exact game name.`
      );
    }

    // link code
    // 4) Insert into DB and set nickname
    // new
    const result = await addRegistrationToDB(targetId, player, message.author.id);
    if (result.success) {
      const guildMember = await message.guild.members.fetch(targetId);
      // assign visitor role after successful registration
      try {
        await guildMember.roles.add(VISITOR_ROLE_ID, `Registered by ${message.author.tag}`);
      } catch (err) {
        console.error('Failed to assign visitor role to ' + guildMember.user.tag + ':', err);
      }
      await message.reply(`The character name ${player.Name}${player.GuildName ? ` from ${player.GuildName}` : ''} has been linked to the account.`);
    } else {
      await message.reply(`Failed: ${result.error}`);
    }
    
  }

  // ---- KB: !kb @discorduser ----
  if (cmd === 'kb' || cmd === 'modkb') {

    if(cmd === 'modkb' && !isAdminOrMod(message.member)){
      return message.reply('You do not have permission to use this command.');
    }

    // accept either: !kb @discorduser  OR  !kb game_name
    const mention = message.mentions.users.first();
    const parts = message.content.trim().split(/\s+/).slice(1);
    if (mention) parts.shift(); // remove mention token
    const nameArg = parts.join(' ').trim();

    if (!mention && !nameArg) {
      return message.reply('Usage: `!kb @discorduser` or `!kb game_name` (game name must be registered).');
    }

    // Determine lookup: by mention OR by registered game name
    let row;
    if (mention) {
      row = findByDiscordId(mention.id);
      if (!row) {
        return message.reply(`${mention} is not linked to any game name.`);
      }
    } else {
      // lookup by game name only if it's registered
      row = findByGameName(nameArg);
      if (!row && cmd !== 'modkb') {
        return message.reply(`The game name **${nameArg}** is not linked to any Discord account in this server.`);
      }
    }

    // show immediate feedback so user knows bot is working
    // const replyMsg = await message.channel.send('Thinking, please wait…');
    await message.channel.sendTyping();

    const is_modkb_fallback = !row && cmd === 'modkb';




    // if(is_modkb_fallback){
    //   return await message.reply({ content: `we think of this`, embeds: [] });
    // }
    
    let gameId, gameName;

    if(row){
      gameId = row.game_id,
      gameName = row.game_name;
    }

    // Fetch player data from Albion API by game_id
    let apiRes;
    const url = is_modkb_fallback 
      ? `https://gameinfo-ams.albiononline.com/api/gameinfo/search?q=${encodeURIComponent(nameArg)}` 
      : `https://gameinfo-ams.albiononline.com/api/gameinfo/players/${encodeURIComponent(gameId)}`;

    try {
      const res = await fetch(url);
      if (res.status === 404) {
        return await message.reply({ content: `Player not found (invalid game id for **${gameName}**).`, embeds: [] });
      }
      if (!res.ok) {
        console.error('KB: Albion API returned', res.status);
        return await message.reply({ content: 'Error contacting Albion API — try again later.', embeds: [] });
      }

      apiRes = is_modkb_fallback 
        ? (await res.json()).players.find(e => e.Name.toLowerCase() === nameArg.toLowerCase()) 
        : await res.json();

      if(is_modkb_fallback && !apiRes){
        return await message.reply({ content: `Player not found (invalid game name for **${nameArg}**)`, embeds: [] });
      }

      if(is_modkb_fallback){
        gameId = apiRes.Id;
        gameName = apiRes.Name;
      }


    } catch (err) {
      console.error('KB: fetch error', err);
      return await message.reply({ content: 'Error contacting Albion API — try again later.', embeds: [] });
    }


    // Map values safely, with fallbacks
    const guildName = apiRes.GuildName ? `[${apiRes.GuildName}](${`https://albiononline.com/killboard/guild/${apiRes.GuildId}`})` : '—';
    const allianceName = apiRes.AllianceName ? `[${apiRes.AllianceName}](${`https://albiononline.com/killboard/alliance/${apiRes.AllianceId}`})` : '—';
    const killFame = typeof apiRes.KillFame === 'number' ? apiRes.KillFame : 0;
    const deathFame = typeof apiRes.DeathFame === 'number' ? apiRes.DeathFame : 0;
    const fameRatio = typeof apiRes.FameRatio === 'number' ? apiRes.FameRatio : 0;
    const pveFame = apiRes.LifetimeStatistics?.PvE?.Total ?? 0;

    // Format numbers with thousands separators
    const fmt = (n) => Number(n).toLocaleString('en-US');

    // Build embed
    const embed = new EmbedBuilder()
      .setTitle('Player info');

    // Profiles (left side) - inline true so it appears left
    const profilesValue = [
      `[MurderLedger](https://murderledger-europe.albiononline2d.com/players/${gameName}/ledger)`,
      `[Albion killboard](https://albiononline.com/killboard/player/${gameId})`,
      `[AlbionBB](https://europe.albionbb.com/players/${gameName})`,
      `[AOTracker](https://aotracker.gg/europe/players/${gameName})`,
    ].join('\n');

    // build a display for the "User" field: ping when lookup used a mention, otherwise show the tag (no ping)

    embed.addFields(
      { name: 'User', value: row ? `<@${row.discord_id}>` : '`N/A`', inline: true },
      { name: 'Game name', value: gameName, inline: true },
      { name: '', value: '', inline: false }, // for organizing data
      {
        name: 'Stats',
        value:
        `**Guild**: ${guildName}\n` +
        `**Alliance**: ${allianceName}\n` +
        `**Kill Fame**: ${fmt(killFame)}\n` +
        `**Death Fame**: ${fmt(deathFame)}\n` +
        `**Ratio**: ${fameRatio}\n` +
        (pveFame !== 0 ? `**PvE Fame**: ${fmt(pveFame)}` : ''),
        inline: true
      },
      { name: 'Profiles', value: profilesValue, inline: true }
    );

    // Send public embed
    await message.reply({ content: null, embeds: [embed] });
    return;
  }

});

client.on('messageCreate', async (message) => {
  try {

    // Guard 1: Bot messages (fastest check, common case)
    if (message.author.bot) return;
    
    // Guard 2: Not a thread (avoid fetching if not thread-based)
    if (!message.channel?.isThread?.()) return;

    // Guard 3 & 4 combined: Validate format and parse in one pass
    const text = message.content.trim();
    const len = text.length;
    if (len < 1 || len > 3) return;

    const firstChar = text.charCodeAt(0);
    const isNegative = firstChar === 45;
    const startIdx = isNegative ? 1 : 0;

    // Validate all remaining chars are digits while parsing
    let num = 0;
    for (let i = startIdx; i < len; i++) {
      const code = text.charCodeAt(i);
      if (code < 48 || code > 57) return; // Not a digit
      num = num * 10 + (code - 48); // Manual parsing
    }

    // Guard 5: Comp lookup (most expensive, do last)
    const comp = getCompByThreadId(message.channel.id);
    if (!comp) return;

    if (num < 1 || num > 60) {
      await message.react('❌').catch(() => {});
      await message.reply('Invalid role number.').catch(() => {});
      return;
    }

    const compId = comp.id,
          parsed_data = {
            roleNumber: num,
            isNegative: isNegative,
            content: text,
          };
  

    await runWithCompLock(compId, async () => {
      const item = {
        channelId: message.channel.id,
        messageId: message.id,
        authorId: message.author.id,
        content: text,
        displayName: message.member?.displayName || message.author.tag
      };
      await runSignupLogic(item, message, compId, parsed_data);
    });



    return;

  } catch (err) {
    console.error('Signup handler error:', err);
  }
});

client.on('messageDelete', (message) => {
  try {
    // Only process if it's a valid message with an ID
    if (!message.id) return;

    // Find comp by message_id
    const comp = db.prepare('SELECT * FROM comps WHERE message_id = ?').get(message.id);
    if (!comp) return; // Not a comp message

    // Delete the comp from database
    db.prepare('DELETE FROM comps WHERE id = ?').run(comp.id);
    
    console.log(`Comp #${comp.id} deleted (message ${message.id} was deleted)`);
  } catch (err) {
    console.error('Error handling comp message deletion:', err);
  }
});

// run on member leave -> delete their registration immediately
client.on('guildMemberRemove', async (member) => {
  try {
    const row = findByDiscordId(member.id);
    if (!row) return; // nothing to do

    // remove registration from DB
    removeRegistrationByDiscordId(member.id);

  } catch (err) {
    console.error('Error handling guildMemberRemove cleanup:', err);
  }
});





client.login(process.env.BOT_TOKEN);
