
import { Singleton, AutoWired, Inject } from 'typescript-ioc';
import { sample, clone, cloneDeep } from 'lodash';
import { compress } from 'lzutf8';

import { Player } from '../../../shared/models';
import { CombatSimulator, CombatAction } from '../../../shared/combat/combat-simulator';
import { ICombat, ICombatCharacter, Profession, ItemSlot, Stat, IBuff, PetUpgrade } from '../../../shared/interfaces';
import { AssetManager } from './asset-manager';
import { PlayerManager } from './player-manager';
import { ItemGenerator } from './item-generator';
import { CalculatorHelper } from './calculator-helper';

import * as Affinities from './affinities';
import * as Professions from './professions';
import { Pet } from '../../../shared/models/Pet';

@Singleton
@AutoWired
export class CombatHelper {

  @Inject private assets: AssetManager;
  @Inject private itemGenerator: ItemGenerator;
  @Inject private playerManager: PlayerManager;
  @Inject private calculatorHelper: CalculatorHelper;

  canDoCombat(player: Player): boolean {
    const players = player.$party ? player.$party.members.map(x => this.playerManager.getPlayer(x)) : [player];
    return !players.some((checkPlayer) => checkPlayer.injuryCount() > checkPlayer.$statistics.get('Game/Premium/Upgrade/InjuryThreshold'));
  }

  createAndRunMonsterCombat(player: Player): ICombat {

    // if no party, just make a random name for this single person
    const characters = {};
    const parties = {};
    const ante = {};

    // player party
    if(player.$party) {
      parties[0] = { id: 0, name: player.$party.name };
    } else {
      parties[0] = { id: 0, name: this.assets.party() };
    }

    // monster party
    parties[1] = { id: 1, name: this.assets.party() };

    // give players ids
    let currentId = 0;

    const playerPartyPlayers = this.getAllPlayerPartyMembers(player);
    const antes = this.getPlayerAntes(playerPartyPlayers);

    const playerParty = this.getAllPartyCombatMembers(playerPartyPlayers)
      .concat(this.getAllPartyCombatPets(playerPartyPlayers));

    playerParty.forEach(combatPlayer => {
      combatPlayer.combatId = currentId;
      combatPlayer.combatPartyId = 0;
      characters[currentId] = combatPlayer;
      ante[currentId] = antes[combatPlayer.realName] || { xp: 0, gold: 0 };
      currentId++;
    });

    const monsters = [];

    // generate monsters to fight against (each player gets one for their level)
    for(let i = 0; i < playerParty.length; i++) {
      const monster = this.createBattleMonster(playerParty[i].level);
      monster.combatId = currentId;
      monster.combatPartyId = 1;
      monsters.push(monster);

      characters[currentId] = monster;
      currentId++;
    }

    const monsterAntes = this.getGenericAntes(monsters);
    Object.assign(ante, monsterAntes);

    const combat: ICombat = {
      timestamp: Date.now(),
      seed: Date.now(),
      name: this.assets.battle(),
      characters,
      parties,
      ante
    };

    return this.startCombat(combat);
  }

  createAndRunPvPCombat(player: Player, targeted: Player): ICombat {

    // if no party, just make a random name for this single person
    const characters = {};
    const parties = {};
    const ante = {};

    // player party
    if(player.$party) {
      parties[0] = { id: 0, name: player.$party.name };
    } else {
      parties[0] = { id: 0, name: this.assets.party() };
    }

    if(targeted.$party) {
      parties[1] = { id: 1, name: targeted.$party.name };
    } else {
      parties[1] = { id: 1, name: this.assets.party() };
    }

    // give players ids
    let currentId = 0;

    // first party
    const playerPartyPlayers = this.getAllPlayerPartyMembers(player);
    const antes = this.getPlayerAntes(playerPartyPlayers);

    const playerParty = this.getAllPartyCombatMembers(playerPartyPlayers)
      .concat(this.getAllPartyCombatPets(playerPartyPlayers));
    playerParty.forEach(combatPlayer => {
      combatPlayer.combatId = currentId;
      combatPlayer.combatPartyId = 0;
      characters[currentId] = combatPlayer;
      ante[currentId] = antes[combatPlayer.realName];
      currentId++;
    });

    // second party
    const playerParty2Players = this.getAllPlayerPartyMembers(targeted);
    const antes2 = this.getPlayerAntes(playerParty2Players);

    const playerParty2 = this.getAllPartyCombatMembers(playerParty2Players)
      .concat(this.getAllPartyCombatPets(playerParty2Players));
    playerParty2.forEach(combatPlayer => {
      combatPlayer.combatId = currentId;
      combatPlayer.combatPartyId = 1;
      characters[currentId] = combatPlayer;
      ante[currentId] = antes2[combatPlayer.realName];
      currentId++;
    });

    const combat: ICombat = {
      timestamp: Date.now(),
      seed: Date.now(),
      name: this.assets.battle(),
      characters,
      parties,
      ante
    };

    return this.startCombat(combat);
  }

  private startCombat(combat: ICombat): ICombat {
    const simulator = new CombatSimulator(combat);
    simulator.events$.subscribe(({ action, data }) => {
      if(action === CombatAction.Victory) {
        if(data.wasTie) return;
        this.handleRewards(data.combat, data.winningParty);
      }

      if(action === CombatAction.IncrementStatistic) {
        const { statistic, value, name } = data;

        const playerRef = this.playerManager.getPlayer(name);
        if(!playerRef) return;

        playerRef.increaseStatistic(statistic, value);
      }
    });

    simulator.beginCombat();

    return combat;
  }

  private getAllPlayerPartyMembers(player: Player): Player[] {
    return player.$party ? player.$party.members.map(x => this.playerManager.getPlayer(x)) : [player];
  }

  private getPlayerAntes(players: Player[]): { [name: string]: { gold: number, xp: number } } {
    return players.reduce((prev, cur) => {
      prev[cur.name] = {
        gold: Math.floor(cur.gold * 0.01),
        xp: Math.floor(cur.xp.total * 0.05)
      };

      return prev;
    }, {});
  }

  private getGenericAntes(combatChars: ICombatCharacter[]): { [id: string]: { gold: number, xp: number } } {
    return combatChars.reduce((prev, cur) => {
      prev[cur.combatId] = {
        gold: Math.max(cur.level * 1000, Math.floor(cur.stats[Stat.GOLD])),
        xp: Math.floor(this.calculatorHelper.calcLevelMaxXP(cur.level) * 0.05)
      };
      return prev;
    }, {});
  }

  private getAllPartyCombatMembers(players: Player[]): ICombatCharacter[] {
    return players.map(partyPlayer => this.createCombatCharacter(partyPlayer));
  }

  private getAllPartyCombatPets(players: Player[]): ICombatCharacter[] {
    return players.map(player => {
      if(!player.$$game.rngService.likelihood(player.$pets.getCurrentValueForUpgrade(PetUpgrade.BattleJoinPercent))) return;

      const pet = player.$pets.$activePet;
      return this.createCombatPet(pet);
    }).filter(x => x);
  }

  private createBattleMonster(generateLevel: number): ICombatCharacter {
    let monsterBase = cloneDeep(sample(
      this.assets.allObjectAssets.monster
        .filter(x => x.level >= generateLevel - 25 && x.level <= generateLevel + 25)
    ));

    const randomProfession = sample(Object.values(Profession));

    if(!monsterBase) {
      const monsterProfession = randomProfession;

      monsterBase = {
        name: `Vector ${monsterProfession}`,
        profession: monsterProfession,
        level: generateLevel,
        stats: {}
      };
    }

    if(monsterBase.profession === 'Random') monsterBase.profession = randomProfession;
    if(!monsterBase.profession) {
      monsterBase.profession = sample(['Monster', 'MagicalMonster']);
    }

    const items = [
      ItemSlot.Body, ItemSlot.Charm, ItemSlot.Feet, ItemSlot.Finger, ItemSlot.Hands,
      ItemSlot.Head, ItemSlot.Legs, ItemSlot.Mainhand, ItemSlot.Neck, ItemSlot.Offhand
    ].map(itemSlot => {
      return this.itemGenerator.generateItem({
        generateLevel,
        forceType: itemSlot
      });
    });

    const professionInstance = Professions[monsterBase.profession] ? new Professions[monsterBase.profession]() : null;
    const affinityInstance = Affinities[monsterBase.attribute] ? new Affinities[monsterBase.attribute]() : null;

    Object.values(Stat).forEach(stat => {
      monsterBase.stats[stat] = monsterBase.stats[stat] || 0;

      // item boosts
      items.forEach(item => {
        if(!item) return;

        monsterBase.stats[stat] += (item.stats[stat] || 0);
      });

      // profession boost
      const profBasePerLevel = professionInstance ? professionInstance.calcLevelStat(this, stat) : 0;
      monsterBase.stats[stat] += profBasePerLevel || 0;

      // affinity boost
      const affBasePerLevel = affinityInstance ? affinityInstance.calcLevelStat(this, stat) : 0;
      monsterBase.stats[stat] += affBasePerLevel || 0;

      // stat multiplier from profession
      const statBase = monsterBase.stats[stat];

      const profMult = professionInstance ? professionInstance.calcStatMultiplier(stat) : 1;
      if(profMult > 1) {
        const addedValue = Math.floor((statBase * profMult)) - statBase;
        monsterBase.stats[stat] += addedValue || 0;
      } else if(profMult < 1) {
        const lostValue = statBase - Math.floor(statBase * profMult);
        monsterBase.stats[stat] -= lostValue || 0;
      }
    });

    // next we do specific-adds from the profession
    // we do these last, despite being additive, because they rely heavily on the stats from before
    const copyStats = clone(monsterBase.stats);
    Object.values(Stat).forEach(checkStat => {
      const profBoosts = professionInstance ? professionInstance.calcStatsForStats(copyStats, checkStat) : [];
      profBoosts.forEach(({ stat, boost }) => {
        monsterBase.stats[stat] += boost || 0;
      });
    });

    // monsters get a free hp boost b/c I said so
    monsterBase.stats[Stat.HP] = Math.max(1, monsterBase.stats[Stat.HP]);
    monsterBase.stats[Stat.HP] += (monsterBase.level * 100);

    Object.keys(monsterBase.stats).forEach(statKey => {
      monsterBase.stats[statKey] = Math.max(monsterBase.stats[statKey], 10);
    });

    monsterBase.maxStats = clone(monsterBase.stats);

    return monsterBase;
  }

  private createCombatCharacter(player: Player): ICombatCharacter {

    const stats = clone(player.currentStats);
    const maxStats = clone(player.currentStats);

    stats[Stat.SPECIAL] = player.$profession.determineStartingSpecial(player);
    maxStats[Stat.SPECIAL] = player.$profession.determineMaxSpecial(player);

    return {
      name: player.fullName(),
      realName: player.name,
      level: player.level.total,
      specialName: player.$profession.specialStatName,
      maxStats,
      stats,
      profession: player.profession
    };
  }

  private createCombatPet(pet: Pet): ICombatCharacter {
    const stats = clone(pet.currentStats);
    const maxStats = clone(pet.currentStats);

    return {
      name: `${pet.name} (${pet.$$player.name}'s Pet)`,
      level: pet.level.total,
      stats,
      maxStats,
      affinity: pet.affinity,
      attribute: pet.attribute,
      rating: pet.rating
    };
  }

  private handleRewards(combat: ICombat, winningParty: number) {
    const winningPlayers = Object.values(combat.characters)
      .filter(x => x.combatPartyId === winningParty)
      .map(x => this.playerManager.getPlayer(x.realName))
      .filter(x => x);

    // remove winner ante so they don't cash in hard or lose too hard
    Object.values(combat.characters).filter(x => x.combatPartyId === winningParty).forEach(char => delete combat.ante[char.combatId]);
    const totalXPAnte = Object.values(combat.ante).reduce((prev, cur) => prev + cur.xp, 0);
    const totalGoldAnte = Object.values(combat.ante).reduce((prev, cur) => prev + cur.gold, 0);

    // split rewards evenly amongst the winners
    winningPlayers.forEach((char) => {
      const earnedGold = Math.floor(totalGoldAnte / winningPlayers.length);
      const earnedXP = Math.floor(totalXPAnte / winningPlayers.length);

      char.gainGold(earnedGold);
      char.gainXP(earnedXP);
    });

    // assign penalties
    Object.values(combat.characters).forEach(x => {
      if(x.combatPartyId !== winningParty) return;

      const player = this.playerManager.getPlayer(x.realName);
      if(!player) return;

      const ante = combat.ante[x.combatId];
      if(!ante) return;

      player.gainGold(-ante.gold);
      player.gainXP(-ante.xp);

      player.addBuff(this.createRandomInjury(player));

    });

  }

  public getCompressedCombat(combat: ICombat): string {
    const data: ICombat = JSON.parse(JSON.stringify(combat));

    delete data.chance;
    Object.values(data.characters).forEach(char => delete char.effects);

    return compress(JSON.stringify(data), { outputEncoding: 'Base64' });
  }

  private createRandomInjury(player: Player): IBuff {
    const injuryName = this.assets.injury();
    const debuffStat = sample([Stat.STR, Stat.INT, Stat.LUK, Stat.CON, Stat.DEX, Stat.HP, Stat.AGI]);
    const debuffValue = Math.floor(player.getStat(debuffStat) * 0.05);

    return {
      name: injuryName,
      statistic: 'Character/Ticks',
      duration: 180,
      stats: { [debuffStat]: -debuffValue }
    };
  }

}
