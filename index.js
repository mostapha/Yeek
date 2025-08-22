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


const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers]
});

client.once(Events.ClientReady, () => {
  console.log(`Bot is ready as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'weapons') {

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
  }

  if (interaction.isUserContextMenuCommand() && interaction.commandName === 'Verify') {
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

      await interaction.reply({ content: `Roles are given to <@${member.id}>` });
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: '❌ Failed to give roles.', ephemeral: true });
    }
  }

  if (interaction.isButton()) {
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

1️⃣ ** Answer these questions:**
• Do you agree to play **only** for Martlock faction? [Yes / No]  
• Can you join voice chat to hear calls? [Yes / No (and tell us why)]  
• Do you have a vouch? [Name of your vouch]

2️⃣ ** Send us the following screenshots:**
• Your character stats
• Your personal faction warfare overview (3rd tab, showing enlist and all time points)

After that, we'll get back to you as soon as possible. Thanks!
`);

      await channel.send({ embeds: [embed] });
    } catch (err) {
      console.error(`❌ Failed to send follow-up message in ${channel.name}:`, err);
    }
  }, 2000); // wait 2 seconds
});

client.login(process.env.BOT_TOKEN);
