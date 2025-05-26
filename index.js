import { Client, GatewayIntentBits, ButtonBuilder, ButtonStyle, ActionRowBuilder, Events } from 'discord.js';
import { config } from 'dotenv';
import { readFile } from 'fs/promises';
import guides from './guides.json' with { type: 'json' };

config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
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
      await interaction.reply({ content: 'You don’t have permission to use this command.', flags: 64 });
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
        content: `# ${role}`,
        components
      });
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
      console.log(path, 'guide length:', guideText.length, guideText.trim().length);
      await interaction.reply({ content: guideText, flags: 64 });
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: 'Error loading guide.', flags: 64 });
    }
  }
});

client.login(process.env.BOT_TOKEN);
