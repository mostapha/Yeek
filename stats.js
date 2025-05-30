#!/usr/bin/env node
import { readFileSync } from 'fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// CLI options for stats viewing
const argv = yargs(hideBin(process.argv))
  .option('user', { type: 'string', description: 'Show stats for a specific user ID' })
  .option('top-weapons', { type: 'boolean', description: 'Show top weapons overall' })
  .option('lookup', { type: 'string', description: 'Lookup Discord tag by user ID' })
  .help()
  .argv;

// Load stats
const stats = JSON.parse(
  readFileSync(new URL('./stats.json', import.meta.url), 'utf8')
);

// Lookup a user's Discord tag by ID
if (argv.lookup) {
  const tag = stats.names?.[argv.lookup] || 'Unknown#0000';
  console.log(`User ${argv.lookup}: ${tag}`);
  process.exit(0);
}

// Show stats for a specific user
if (argv.user) {
  const userId = argv.user;
  const userStats = stats.users[userId];
  const tag = stats.names?.[userId] || 'Unknown#0000';
  if (!userStats) {
    console.log(`No stats found for user ID ${userId}`);
    process.exit(0);
  }
  console.log(`Stats for ${tag} (${userId}):`);
  console.log(`  Total guides opened: ${userStats.total}`);
  console.log('  By weapon:');
  for (const [weapon, count] of Object.entries(userStats.weapons)) {
    console.log(`    ${weapon}: ${count}`);
  }
  process.exit(0);
}

// Show top weapons overall
if (argv['top-weapons']) {
  console.log('Top weapons overall:');
  const sorted = Object.entries(stats.weapons).sort(([, a], [, b]) => b - a);
  for (const [weapon, count] of sorted) {
    console.log(`  ${weapon}: ${count}`);
  }
  process.exit(0);
}

// Default summary: weapon usage and top users
console.log('Overall weapon usage:');
for (const [weapon, count] of Object.entries(stats.weapons)) {
  console.log(`  ${weapon}: ${count}`);
}

console.log('\nTop users by total openings:');
const topUsers = Object.entries(stats.users)
  .sort(([, a], [, b]) => b.total - a.total)
  .slice(0, 10);
for (const [userId, data] of topUsers) {
  const tag = stats.names?.[userId] || 'Unknown#0000';
  console.log(`  ${tag} (${userId}): ${data.total}`);
}
