export const common = {
  guard_rune: `
### What does it do?
It gives damage **resistance** and **immunity** to forced movement effects and stuns
### How to use it?
You need to react fast and use the Guard Rune in these situations:
- When passing chokes: most people die on chokes, so when we pass in a narrow places like chokes and bridges drop a Guard Rune there so we can pass safely.
- To counter bombs: Guard Rune gives resistance and immunity to pulls, so it's good spell to counter bombs, if you see a witchwork E for example you need to react fast and drop the Guard Rune on it before it pulls our teamates
- To counter enemy engages: If enemy caller is engaging on you and you have Guard Rune you can drop it for your teamates.
- To support DPS: you can play Guard Rune offensively by droping it in front of your dps, this will make it hard for the enemy to stop the dps.
`,
  
  sacred_ground: `
### What does it do?
It silences anyone who steps over it
### How to use it?
Keep using it every time you have it to silence the front of your zerg, this helps if enemy try to engage, as some of them will get silenced, this spell also shines in chokes, as droping it in a choke makes it hard for enemy zerg to engage.
### offensive use:
If you want to help your team even more, you can use this spell offensively in two ways:
- Silence the enemy stoppers: When your team is going for engage, silence the enemy tank that you think will stop your team's engage, all you need to do is to drop the Q spell on the tank if he's is in range, but don't waste any other spell to do this.
- Silence the enemy clump: When your caller pulls enemies for engage, drop you Q spell on the clump so they can't use any spells.
`,
  motivating_cleanse: `
### What does it do?
Cleanses all crowd control effects and debuffs.
### How to use it
Use this spell only to cleanse your teammates, don't use it to get movement speed unless you are left behind alone dying.
- Cleanse only when you see crowd control effects and debuffs, things you can cleanse are:
  - crowd controls: like root, slow, stun, silence...
  - Debuffs: like resistance reduction, HP cut, anti-heals effects...
- You need to have fast reaction try to cleanse as quick as you can.
- This is very important spell so don't waste it just to get bonus movement speed for short time.
There are obvious situations when the cleanse is needed, for example:
- Engages: when enemy is engaging, they will drop a lot of debuffs like pierce and hp cuts, you can cleanse it to save your party.
- cc weapons: there are weapons that cc, you need to cleanse when you see them like permafrost and witchwork.
`
};


export function insertCommon(text) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => common[key]?.trim() || '');
}