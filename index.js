import { Client, GatewayIntentBits, ButtonBuilder, ButtonStyle, ActionRowBuilder, Events, ChannelType, EmbedBuilder } from 'discord.js';
import { config } from 'dotenv';
import { readFile, writeFile } from 'fs/promises';
import { readFileSync as readSync } from 'fs';
import guides from './guides.json' with { type: 'json' };


config();

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
    name: "Tank",
    icon: "https://i.imgur.com/pTz9rko.png",
    title: "Tank Roles",
    text: "The tanks can sustain damage more than any other role, that's why they usually play in frontlines, there are different types of tanks and here are some of them",
    children: [
      {
        name: "Clumper Tank",
        title: "Clumper Tanks",
        text: "The clumper or engage tanks are the ones who gather and clump enemy players at one place to help our DPS kill them, they can also do fake engages or help the caller catch more people",
        children: [
          {
            name: "Golem", title: "Earthrune Staff (Golem)",
            icon: "https://render.albiononline.com/v1/item/T8_2H_SHAPESHIFTER_KEEPER?quality=4&size=60",
            text: "One of the best clumping weapons in the game; can make clumps both using W and E spell; the E spell pulls any amount of players in range; 25 seconds cooldown."
          },
          {
            name: "Hoj", title: "Hand of Justice",
            icon: "https://render.albiononline.com/v1/item/T8_2H_HAMMER_AVALON?quality=4&size=60",
            text: "Very nice clumping weapon; used mostly in small-scale fights; needs more skill compared to golem; can only pull 10 players max; 30 seconds cooldown."
          },
          {
            name: "1h Mace", title: "1h Mace",
            icon: "https://render.albiononline.com/v1/item/T8_MAIN_MACE?quality=4&size=60",
            text: "decent clumping weapon; you clump with your W spell (Air Compressor); pulls all players in range of the spell; 30 seconds cooldown"
          },
          {
            name: "Camlann", title: "Camlann Mace",
            icon: "https://render.albiononline.com/v1/item/T8_2H_MACE_MORGANA?quality=4&size=60",
            text: "Out of meta weapon; not used often; You hit enemy player with E spell then all enemies around him get pulled to him; 25 seconds cooldown"
          }
        ]
      },
      {
        name: "Stopper Tank", title: "Stopper Tanks",
        text: "Tanks that defend our team from enemy engages, their job is to watch enemy zerg and stop them when they try to engage us",
        children: [
          {
            name: "Heavy Mace", title: "Heavy Mace", icon: "https://render.albiononline.com/v1/item/T8_2H_MACE?quality=4&size=60",
            text: "Great stopping weapon; have many utilities to stop enemies; Q spell (silences); W spell (roots, interrupts); E spell (silences); used with hellion hood or judicator helmet"
          },
          {
            name: "1h Mace", title: "1h Mace", icon: "https://render.albiononline.com/v1/item/T8_MAIN_MACE?quality=4&size=60",
            text: "Same as Heavy Mace, great stoping weapon; all the spells can help stop engages, especially the W (roots, interrupts) and the E spell (slows, interrupts); used with hellion hood or judicator helmet"
          },
          {
            name: "1h Hammer", title: "1h Hammer", icon: "https://render.albiononline.com/v1/item/T8_MAIN_HAMMER?quality=4&size=60",
            text: "1h hammer is decent to stop and control enemy zerg; the E spell have long stun time; it doesn't have mobility but has short cooldown (15s); can either use second W (dash towards enemy) or last W (Inertia Ring) to slow enemy engages; used with hellion hood or judicator helmet; best played in brawl fights"
          },
          {
            name: "Great Hammer", title: "Great Hammer", icon: "https://render.albiononline.com/v1/item/T8_2H_HAMMER?quality=4&size=60",
            text: "Just another 1h hammer but with some mobility; Can stop engages by dashing to enemies (knocks them back and stun them); can use last W to slow; used with hellion hood or judicator helmet"
          },
          {
            name: "Grovekeeper", title: "Grovekeeper", icon: "https://render.albiononline.com/v1/item/T8_2H_RAM_KEEPER?quality=4&size=60",
            text: "Stops engages using E spell by jumping towards them and lock them in place (stuns, throwing in air); same as other hammer we use last W to slow and we use it with hellion hood or judicator helmet"
          },
          {
            name: "Grail Seeker", title: "Grail Seeker", icon: "https://render.albiononline.com/v1/item/T8_2H_QUARTERSTAFF_AVALON?quality=4&size=60",
            text: "Stops engages using E spell by rooting enemies for very long time; we use last Q (Cartwheel) and 4th W (Rising Blow) for more cc; also used with hellion hood or judicator helmet"
          }
        ]
      },
      {
        name: "Support Tank", title: "Support Tanks",
        text: "This tanks support the team by puting pressure on enemy zerg or by helping the caller catch more people",
        children: [
          {
            name: "Staff of balance", title: "Staff of balance", icon: "https://render.albiononline.com/v1/item/T8_2H_ROCKSTAFF_KEEPER?quality=4&size=60",
            text: "Staff of balance goes inside enemy zerg and uses his E to slow them by 50% and reduce their healing by 35%"
          },
          {
            name: "1h Mace", title: "1h Mace", icon: "https://render.albiononline.com/v1/item/T8_MAIN_MACE?quality=4&size=60",
            text: "1h mace has a lot of crowd control spells; it's great for putting pressure on enemy as you just keep controlling them over and over"
          },
          {
            name: "Heavy mace", title: "Heavy mace", icon: "https://render.albiononline.com/v1/item/T8_2H_MACE?quality=4&size=60",
            text: "Same as 1h mace, a lot of crowd controls spells, when used offensively you can just control enemies over and over which help the team a lot"
          },
          {
            name: "Forge Hammers", title: "Forge Hammers", icon: "https://render.albiononline.com/v1/item/T8_2H_DUALHAMMER_HELL?quality=4&size=60",
            text: "Forge Hammers E spell makes you very tanky, you can go inside enemy zerg and use E spell and keep crashing and controlling them over and over (slows, throws in air), very good pressure weapon"
          },
        ]
      }
    ]
  },
  {
    name: "Support",
    icon: "https://i.imgur.com/Qcrm1N9.png",
    title: "Support Roles",
    text: "Support roles are all about helping the team either defensively or offensively.",
    children: [
      {
        name: "Defensive support",
        title: "Defensive support",
        text: "Defensive support usually assist the team by giving shields, cleanses and different utilities that keeps the team alive",
        children: [
          {
            name: "1h arcane", title: "Arcane Staff", icon: "https://render.albiononline.com/v1/item/T8_MAIN_ARCANESTAFF?quality=4&size=60",
            text: "The E spell silences and purges enemy players hit, it's good to stop engages and bombs; and because it's an arcane we also get cool spells from Q and W like the shields and cleanse"
          },
          {
            name: "Great arcane", title: "Great arcane", icon: "https://render.albiononline.com/v1/item/T8_2H_ARCANESTAFF?quality=4&size=60",
            text: "The E spell Stops and freezes enemy players for short time, they can't do anything in that time, so it's good to stop or set up engages; and because it's an arcane we also get cool spells from Q and W like the shields and cleanse"
          },
          {
            name: "Bedrock", title: "Bedrock Mace", icon: "https://render.albiononline.com/v1/item/T8_MAIN_ROCKMACE_KEEPER?quality=4&size=60",
            text: "The E spell knocks enemies back for long distance; it's good to delay enemies from engaging or to block them from coming closer; and because it's a mace get nice spells from the W and Q like guard rune that gives defense and immunity of movements effects"
          },
          {
            name: "Locus", title: "Malevolent Locus", icon: "https://render.albiononline.com/v1/item/T8_2H_ENIGMATICORB_MORGANA?quality=4&size=60",
            text: "The E spell create a big area of buff to allies, the area gives damage resistance and keeps cleansing all crowd control effects; and because it's an arcane we also get cool spells from Q and W like the shields and cleanse"
          },
          {
            name: "Rootbound", title: "Rootbound Staff", icon: "https://render.albiononline.com/v1/item/T8_2H_SHAPESHIFTER_SET2?quality=4&size=60",
            text: "The E spell of Rootbound gives more HP to allies around, and give you access to a spell that shield allies for up to 3 seconds and protects from movements spells"
          },
          {
            name: "Oathkeepers", title: "Oathkeepers", icon: "https://render.albiononline.com/v1/item/T8_2H_DUALMACE_AVALON?quality=4&size=60",
            text: "The E spell of Oathkeeper gives shield to allies, the shield blocks some damage and grants bonus movement speed; and because it's a mace you get nice spells from the Q and W like guard rune that gives defense and immunity to movements effects"
          },
          {
            name: "Enigmatic", title: "Enigmatic Staff", icon: "https://render.albiononline.com/v1/item/T8_2H_ENIGMATICSTAFF?quality=4&size=60",
            text: "The E spell shield an ally and the people around him, it's good defensive tool; and because it's an arcane we also get cool spells from Q and W like the shields and cleanse"
          },
          {
            name: "Black monk", title: "Black Monk Stave", icon: "https://render.albiononline.com/v1/item/T8_2H_COMBATSTAFF_MORGANA?quality=4&size=60",
            text: "The E spell of Black Monk Stave reduces damage of enemies hit by 30% each 0.75s; so if enemy tried to engage but black monk hit them they will barely do any damage to us"
          }
        ]
      },
      {
        name: "Offensive support", title: "Offensive support", text: "The offensive support is the ones who make it easier to secure kills, it's usually weapons that put debuffs on enemies and make them weaker and vulnerable to our damage",
        children: [
          {
            name: "HP cut", title: "HP cut", text: "The hp cut support are weapons that reduce max and current health points to enemies, enemies with less health are easier to kill",
            children: [
              {
                name: "Incubus", title: "Incubus Mace", icon: "https://render.albiononline.com/v1/item/T8_MAIN_MACE_HELL?quality=4&size=60",
                text: "The incubus mace can reduce max and current HP to enemies by 40% for 8 seconds, it take nearly half HP of players; and because it's a mace we also get guard rune and silence Q"
              },
              {
                name: "Realmbreaker", title: "Realmbreaker", icon: "https://render.albiononline.com/v1/item/T8_2H_AXE_AVALON?quality=4&size=60",
                text: "We can also consider it as DPS weapon, but the Realmbreaker takes 15% max and current HP from enemies hit plus the damage it deals, which makes it very good offensive support weapon"
              },
            ]
          },
          {
            name: "Resistance Reduction", title: "Damage Resistance Reduction", text: "There are weapons that reduce the damage resistance from enemies, it's very imprortant to have some of them in the party to make sure you get kills when engaging; Enemies with less damage resistance are easier to kill",
            children: [
              {
                name: "Damnation", title: "Damnation Staff", icon: "https://render.albiononline.com/v1/item/T8_2H_CURSEDSTAFF_MORGANA?quality=4&size=60",
                text: "The damnation E spell makes a big area of pierce, it reduces damage resistances to all people around the targeted area which makes it one of the best piercing weapons; the only downside is slow cast time which can be fixed using scholar robe or morgana cape"
              },
              {
                name: "Spirit", title: "Spirithunter", icon: "https://render.albiononline.com/v1/item/T8_2H_HARPOON_HELL?quality=4&size=60",
                text: "Spirithunter is a pierce weapon that also does damage; it reduces magical resistance and damage resistances for enemies hit; it can hit immediately which makes it great piercing choice"
              },
              {
                name: "Shadowcaller", title: "Shadowcaller", icon: "https://render.albiononline.com/v1/item/T8_MAIN_CURSEDSTAFF_AVALON?quality=4&size=60",
                text: "Shadowcaller is the weapon with most damage resistance reduction, getting hit by shadowcaller makes you nearly naked, the only downside is that it's a little bit slow and needs to time it right to get benefit of it"
              },
              {
                name: "Carving", title: "Carving Sword", icon: "https://render.albiononline.com/v1/item/T8_2H_CLEAVER_HELL?quality=4&size=60",
                text: "Carving sword is a pierce weapon worth mentioning, it reduces damage resistance based on stacks from Q's and W's, the more stacks you have the more pierce you get"
              }
            ]
          },
          {
            name: "Other offensive support", title: "Other offensive support", text: "There are other offensive support weapons that give special abilities and helps the team secure kills in the engages",
            children: [
              {
                name: "Lifecurse", title: "Lifecurse Staff", icon: "https://render.albiononline.com/v1/item/T8_MAIN_CURSEDSTAFF_UNDEAD?quality=4&size=60",
                text: "The Lifecurse E purges all buffs from enemies hit (shields, helmets, jacket, boots buffs all get purged), it also does damage over time to them"
              },
              {
                name: "Rotcaller", title: "Rotcaller", icon: "https://render.albiononline.com/v1/item/T8_MAIN_CURSEDSTAFF_CRYSTAL?quality=4&size=60",
                text: "The Rotcaller E spell gives enemies hit a debuff that prevents them from getting healed for 2 seconds"
              },
            ]
          },
        ]
      },
      {
        name: "Other support", title: "Other support", text: "There are other support that help the team either by giving buffs or debuffing enemy players, and here are some of them",
        children: [
          {
            name: "Occult", title: "Occult Staff", icon: "https://render.albiononline.com/v1/item/T8_2H_ARCANESTAFF_HELL?quality=4&size=60",
            text: "Occult staff is a mobility support weapon, the E spell creates a long corridor or carpet that increases the movement speed of all allies by 60%, it can be used either offensively when the is engaging or defensively when team is kiting, or just use it to reposition the zerg."
          },
          {
            name: "Icicle Staff", title: "Icicle Staff", icon: "https://render.albiononline.com/v1/item/T8_2H_ICEGAUNTLETS_HELL?quality=4&size=60",
            text: "The Icicle Staff is a support weapon that slows enemy players. The E spell create an area of blizzard or storm that slows everyone inside by 50%, when played offensively it slows enemies so our team can get to them quickly and when played defensively it slows enemies so our team can kite and get away"
          },
        ]
      },
    ]
  },
  {
    name: "DPS",
    icon: "https://i.imgur.com/VzXPai6.png",
    title: "DPS Roles",
    text: "The DPS job is to kill clumps, when the caller gathers enemy players or asks to engage the dps players drop their E spells in hope of getting kills",
    children: [
      {
        name: "Permafrost", title: "Permafrost Prism", icon: "https://render.albiononline.com/v1/item/T8_2H_ICECRYSTAL_UNDEAD?quality=4&size=60",
        text: "Permafrost is great dps weapon, in addition to its good damage, the E spell stuns enemies and lock them in place. the perma frost player should have fast reaction time and can predict where the engages will be, so he can hit before every other dps"
      },
      {
        name: "Spiked", title: "Spiked Gauntlets", icon: "https://render.albiononline.com/v1/item/T8_2H_KNUCKLES_SET3?quality=4&size=60",
        text: "Spiked is a very important DPS weapon. Its special trait is that it deals extra damage to Plate armor users, making it the perfect weapon to kill tanks, we only take 1 spiked per party because the damage does not stack."
      },
      {
        name: "Rift", title: "Rift Glaive", icon: "https://render.albiononline.com/v1/item/T8_2H_GLAIVE_CRYSTAL?quality=4&size=60",
        text: "Rift Glaive is a great DPS weapon. It has very high instant burst damage, which makes it a top pick in clap comps"
      },
      {
        name: "Hellfire", title: "Hellfire Hands", icon: "https://render.albiononline.com/v1/item/T8_2H_KNUCKLES_HELL?quality=4&size=60",
        text: "Hellfire Hands is also one of the best dps weapons, in addition to is good damage it also applies a debuff which reduces healing received"
      },
      {
        name: "Dawnsong", title: "Dawnsong", icon: "https://render.albiononline.com/v1/item/T8_2H_FIRE_RINGPAIR_AVALON?quality=4&size=60",
        text: "Dawnsong is also one of the best dps weapons, it has nice burst damage in long area and also applies a debuff which reduces healing received to enemies hit"
      },
      {
        name: "Infinity blade", title: "Infinity blade", icon: "https://render.albiononline.com/v1/item/T8_MAIN_SWORD_CRYSTAL?quality=4&size=60",
        text: "Infinity blade is another decent dps weapon, it does high damage to all enemies in front of you, the E spell increases all damage by 35% for 5 seconds which also oosts the output damage of Q and W spells for a short time, it's good weapon for brawling comps"
      },
      {
        name: "bear paws", title: "bear paws", icon: "https://render.albiononline.com/v1/item/T8_2H_DUALAXE_KEEPER?quality=4&size=60",
        text: "Bear paws is good damage weapon when going for brawl comps, you can put so much pressure on enemies while being able to sustain damage while brawling"
      },
      {
        name: "Battle Bracers", title: "Battle Bracers", icon: "https://render.albiononline.com/v1/item/T8_2H_KNUCKLES_SET2?quality=4&size=60",
        text: "Very high burst damage weapon, the damage is instant which makes good very good option, the weapon used in melee and brawling comps"
      },
      {
        name: "Infernal Scythe", title: "Infernal Scythe", icon: "https://render.albiononline.com/v1/item/T8_2H_SCYTHE_HELL?quality=4&size=60",
        text: "the infernal scythe is decent weapon for brawling comps, it got nerfed to the ground, the E spell now does not stack with other infernal scythes, but having one in the party is good addition to execute low HP enemies"
      },
      {
        name: "Ursine Maulers", title: "Ursine Maulers", icon: "https://render.albiononline.com/v1/item/T8_2H_KNUCKLES_KEEPER?quality=4&size=60",
        text: "The Ursine Maulers is a nice addition to melee and brawl comps, the E spell if used correctly does a huge amount of damage to all enemies hit"
      },
      {
        name: "Longbow", title: "Longbow", icon: "https://render.albiononline.com/v1/item/T8_2H_LONGBOW?quality=4&size=60",
        text: "The Longbow is a great DPS option, the E spell does a huge damage output if full channeled, we can use it in both brawling or clap comps"
      },
      {
        name: "Wailing Bow", title: "Wailing Bow", icon: "https://render.albiononline.com/v1/item/T8_2H_BOW_HELL?quality=4&size=60",
        text: "The Wailing bow E spell does a very high damage if the enemies are stacked, used a lot in bomb squads, can be used in clap comp as it has high burst damage"
      },
      {
        name: "Heron spear", title: "Heron spear", icon: "https://render.albiononline.com/v1/item/T8_MAIN_SPEAR_KEEPER?quality=4&size=60",
        text: "The Heron spear can be used in melee, brawl or even one shot comps, the E spell stuns enemies and does very high damage, the W spell also have decent damage which gives the weapon huge damage output if used correctly"
      },
      {
        name: "Demonfang", title: "Demonfang", icon: "https://render.albiononline.com/v1/item/T8_MAIN_DAGGER_HELL?quality=4&size=60",
        text: "Demonfang is also a respected choice when going for melee comps or when brawling, the E ability when combined with 1st W spell outputs a huge burst damage"
      },
      {
        name: "Astral staff", title: "Astral staff", icon: "https://render.albiononline.com/v1/item/T8_2H_ARCANESTAFF_CRYSTAL?quality=4&size=60",
        text: "The Astral Staff is a decent choice for brawling comps, the E spell cannot be interrupted, it's good pressure weapon with high damage that melts enemies if they are not careful"
      },
    ]
  },
  {
    name: "Healer",
    icon: "https://i.imgur.com/zzszaGj.png",
    title: "Healer Roles",
    text: "Healers focusing on restoring health and supporting allies.",
    children: [
      {
        name: "Hallowfall", title: "Hallowfall", icon: "https://render.albiononline.com/v1/item/T8_MAIN_HOLYSTAFF_AVALON?quality=4&size=60",
        text: "Hallowfall could be the best healing staff in the game, it has really good healing and comes with a mobility option, it's the first choice for healers in small scale or zvz in general"
      },
      {
        name: "Redemption", title: "Redemption Staff", icon: "https://render.albiononline.com/v1/item/T8_2H_HOLYSTAFF_UNDEAD?quality=4&size=60",
        text: "Redemption Staff has huge healing output which makes it decent choice for zvzs, the E spell throws out a ball that bounces between nearby allies and heals every time it passes"
      },
      {
        name: "Fallen Staff", title: "Fallen Staff", icon: "https://render.albiononline.com/v1/item/T8_2H_HOLYSTAFF_HELL?quality=4&size=60",
        text: "Fallen Staff heals up to 20 allies with higher output than any other holy staff, and it also gives a 2-second damage immunity shield, removing dots, debuffs, and crowd control. The catch is the effect only starts 2 seconds after you cast, so timing is really important"
      },
      {
        name: "Blight Staff", title: "Blight Staff", icon: "https://render.albiononline.com/v1/item/T8_2H_NATURESTAFF_HELL?quality=4&size=60",
        text: "Blight Staff is a solid nature healing option for ZvZ or small scale fights. The E spell gives uninterruptible healing while channeling and boosts movement speed, making it easier to follow allies or reposition, and it can heal up to 10 allies"
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


const embedStartTitle = "Albion zvz roles";

const intro_text = `
    In organized group fights, it's important to have specific roles in your party to put proper fight. You'll need tanks, support, DPS, and healers. If you're missing one of these, things can get a bit tricky.  

    The number of each role really depends on the type of content or the caller. Some callers like having a lot of tanks, while others want more damage. In general, having a balanced team usually works best.  

    We'll go over some common roles in group fights and how they help the team do well. This is just from my own experience in the game, so it might not cover everything, but it's a good starting point for anyone interested in ZvZ content.
    `
const startedPanelObject = { title: embedStartTitle, text: intro_text, icon: "https://i.imgur.com/HlGNoNN.png", children: rolesTree };


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
            .setCustomId(`open:${[...path, child.name].join(">")}`)
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
        .setCustomId(`back:${path.join(">")}`)
        .setLabel("⬅ Back")
        .setStyle(ButtonStyle.Secondary)
    );
    rows.push(backRow);
  }

  return { embeds: [embed], components: rows, flags: 64 };
}




const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildScheduledEvents]
});

client.once(Events.ClientReady, () => {
  console.log(`Bot is ready as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand()) {


    switch (interaction.commandName) {
      case "weapons":

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

I made this based on my own experience and what I know about the weapons. There might be some mistakes or missing info, but I think it's a good starting point. Feel free to DM <@760271416544722944> for any feedback about it. You can check each weapon's guide by clicking the button and scrolling down.`
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
      case "roles":

        // Check if command is used in the right server
        const allowedUserId = "760271416544722944"

        if (interaction.user.id !== allowedUserId) {
          return await interaction.reply({
            content: "You are not allowed to use this command.",
            flags: 64
          });
        }

        const rolesMainEmbedText = `
  There are many roles you can play if we talking about zvz, this tool can give you a brief info and details about some of them

  This guide only covers the basics to get you started, it only meant for newcomers and beginers, each weapon has way more depth than what's written here
  `;

        const main_roles_guide_embed = new EmbedBuilder()
          .setTitle("Albion ZvZ Roles Basics")
          .setColor(0xF1C40F)
          .setDescription(rolesMainEmbedText);

        const open_roles_guide_button = new ButtonBuilder()
          .setCustomId('case:open_roles_guide') // A unique identifier for the button
          .setLabel('Check Roles Info')           // The text displayed on the button
          .setStyle(ButtonStyle.Primary),  // The visual style of the button (e.g., Primary, Danger, Success, Secondary, Link)

          open_roles_guide_row = new ActionRowBuilder()
            .addComponents(open_roles_guide_button);

        await interaction.reply({ embeds: [main_roles_guide_embed], components: [open_roles_guide_row] });


        break;
      case "bandit":

        const timeStr = interaction.options.getString('time');
        const show = interaction.options.getBoolean('show') || false;

        // Validate HH:MM
        const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(timeStr);
        if (!match) {
          return interaction.reply({ content: '❌ Please use format HH:MM (24h). Example: 13:22', ephemeral: true });
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
          .setThumbnail("https://i.imgur.com/t4QMNiq.png");


        await interaction.reply({
          embeds: [embed],
          ephemeral: !show
        });

        break;
    }


  } else if (interaction.isUserContextMenuCommand()) {
    if (interaction.commandName === 'Verify') {
      try {

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

        const member = await interaction.guild.members.fetch(interaction.targetId);

        // roles to add
        const roleIds = [
          '1247887205133713438', // highlander
          '1338515855709044757' // eolgard
        ];

        for (const roleId of roleIds) {
          await member.roles.add(roleId);
        }

        await interaction.reply({ content: `Roles are given to <@${member.id}>`, ephemeral: true });
      } catch (err) {
        console.error(err);
        await interaction.reply({ content: '❌ Failed to give roles.', ephemeral: true });
      }
    }
  } else if (interaction.isButton()) {

    // weapons guide buttons contains "::" so we find them here
    if (interaction.customId.includes('::')) {
      const [category, weapon] = interaction.customId.split('::');
      const path = guides[category]?.[weapon];

      if (!path) {
        return interaction.reply({ content: 'Guide not found.', flags: 64 });
      }

      try {
        const guideText = await readFile(new URL(`./guides/${path}`, import.meta.url), 'utf8');
        await interaction.reply({ content: guideText, flags: 64 });

        // Get nickname or fallback to username/tag
        const displayName = interaction.member?.displayName || interaction.member?.nickname || interaction.user.tag;

        // Log the event
        if (interaction.user.id !== '760271416544722944') {
          console.log(`${weapon} guide requested by: ${displayName} (ID: ${interaction.user.id})`);
        }
        recordStat(interaction.user.id, weapon, displayName);

      } catch (err) {
        console.error(err);
        await interaction.reply({ content: 'Error loading guide.', flags: 64 });
      }
    } else {

      // Special button: open the root "Roles Guide" panel
      if (interaction.customId === 'case:open_roles_guide') {
        const rootEmbed = buildMessage(startedPanelObject, []);
        return await interaction.reply(rootEmbed);
      }

      // Example: "open:Tank>Hammer>One-Handed Hammer"
      const [action, rawPath] = interaction.customId.split(":");
      const path = rawPath ? rawPath.split(">") : [];

      // Get the node at the given path
      const currentNode = getNode(path, rolesTree);

      // If node doesn’t exist anymore → notify user
      if (!currentNode) {
        return await interaction.reply({
          content: "This guide section no longer exists.",
          flags: 64 // ephemeral
        });
      }

      // Handle actions
      if (action === "open") {
        // Update the message with the selected node’s content
        await interaction.update(buildMessage(currentNode, path));
      } else if (action === "back") {
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

  }


});

client.on('channelCreate', async (channel) => {
  if (!channel.isTextBased() || channel.type !== ChannelType.GuildText) return;

  const ticketCategoryId = process.env.TICKETS_CATEGORY_ID;
  if (channel.parentId !== ticketCategoryId) return;
  if (!channel.name.startsWith('ticket-')) return;


  setTimeout(async () => {
    try {
      if (!channel.permissionsFor(channel.guild.members.me).has('SendMessages')) return;

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71) // green tone, change if you want
        .setTitle('Verification Checklist')
        .setDescription(`
Follow the steps below so we can verify your account:

<:N9_1:1410821676924538891>**Answer these questions:**
<:STBF11:1410819715588296815>Do you agree to play **only** for Martlock faction?
<:STBF11:1410819715588296815>Do you understand English?
<:STBF11:1410819715588296815>Can you join voice chat to hear calls? (no need to talk)

<:N9_2:1410821683320721478>**Send us the following screenshots:**
<:STBF11:1410819715588296815>Your character stats
<:STBF11:1410819715588296815>Your personal faction warfare overview (3rd tab, showing enlist and all time points)

After that, we'll get back to you as soon as possible. Thanks!
`);

      await channel.send({ embeds: [embed] });
    } catch (err) {
      console.error(`❌ Failed to send follow-up message in ${channel.name}:`, err);
    }
  }, 2000); // wait 2 seconds
});

client.login(process.env.BOT_TOKEN);
