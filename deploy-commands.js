import { REST, Routes, SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType } from 'discord.js';
import { config } from 'dotenv';

config();

const commands = [
  new SlashCommandBuilder()
    .setName('weapons')
    .setDescription('Shows basic Albion clap weapons guide')
    .toJSON(),

  new ContextMenuCommandBuilder()
    .setName('Verify')               // This will show in right-click menu
    .setType(ApplicationCommandType.User)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('bandit')
    .setDescription('Calculate next bandit time window')
    .addStringOption(option =>
      option.setName('time')
        .setDescription('Start time (HH:MM, 24h format)')
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option.setName('show')
        .setDescription('Show result to everyone? (default: no)')
        .setRequired(false)
    )
    .toJSON()

];

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

try {
  console.log('🚀 Registering commands...');
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
  console.log('✅ Commands registered.');
} catch (error) {
  console.error(error);
}
