import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config } from 'dotenv';

config();

const commands = [
  new SlashCommandBuilder()
    .setName('weapons')
    .setDescription('Shows basic Albion clap weapons guide')
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
