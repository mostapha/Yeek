import { REST, Routes, SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits } from 'discord.js';
import { config } from 'dotenv';

config();

const commands = [
  new SlashCommandBuilder()
    .setName('weapons')
    .setDescription('Shows basic Albion clap weapons guide')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new ContextMenuCommandBuilder()
    .setName('Verify')               // This will show in right-click menu
    .setType(ApplicationCommandType.User)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .toJSON(),

  new ContextMenuCommandBuilder()
    .setName('Update name')
    .setType(ApplicationCommandType.User)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .toJSON(),

  new ContextMenuCommandBuilder()
    .setName('Internal Note')
    .setType(ApplicationCommandType.User)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

    
  new ContextMenuCommandBuilder()
    .setName('Edit Comp')
    .setType(ApplicationCommandType.Message)
    .setDefaultMemberPermissions(PermissionFlagsBits.MentionEveryone)
    .toJSON(),

  new ContextMenuCommandBuilder()
    .setName('Check Comp')
    .setType(ApplicationCommandType.Message)
    .setDefaultMemberPermissions(PermissionFlagsBits.MentionEveryone)
    .toJSON(),


  new SlashCommandBuilder()
    .setName('bandit')
    .setDescription('Calculate next bandit time window')
    .addStringOption(option =>
      option.setName('time')
        .setDescription('Start time (HH:MM, 24h format); use UTC time')
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option.setName('show')
        .setDescription('Show result to everyone? (default: no)')
        .setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('roles')
    .setDescription('Shows the zvz roles basics guide')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('comp_create')
    .setDescription('Create a party comp')
    .setDefaultMemberPermissions(PermissionFlagsBits.MentionEveryone)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('comp_assign')
    .setDescription('Organizer: assign or unassign a user to a slot (use inside the comp thread)')
    .addIntegerOption(option =>
      option.setName('slot')
        .setDescription('Role number')
        .setRequired(true)
    )
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to assign (mention)')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.MentionEveryone)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('comp_edit')
    .setDescription('Organizer: edit your comp (use inside the comp thread)')
    .setDefaultMemberPermissions(PermissionFlagsBits.MentionEveryone)
    .toJSON(),

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
