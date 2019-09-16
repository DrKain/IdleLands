
import { AutoWired, Singleton, Inject } from 'typescript-ioc';
import { set } from 'lodash';
import { DatabaseManager } from './database-manager';
import { GuildMemberTier, Channel, GuildChannelOperation, IItem, EventName,
  IBuffScrollItem, GuildBuilding } from '../../../shared/interfaces';
import { Guild, Player, Item } from '../../../shared/models';
import { PlayerManager } from './player-manager';
import { SubscriptionManager } from './subscription-manager';
import { EventManager } from './event-manager';
import { DiscordManager } from './discord-manager';

@Singleton
@AutoWired
export class GuildManager {

  @Inject private db: DatabaseManager;
  @Inject private subscriptionManager: SubscriptionManager;
  @Inject private eventManager: EventManager;
  @Inject private playerManager: PlayerManager;
  @Inject private discordManager: DiscordManager;

  private guilds: { [key: string]: Guild } = { };

  public get allGuilds() {
    return this.guilds;
  }

  public async init() {
    await this.loadGuilds();

    this.subscribeToGuilds();
  }

  private subscribeToGuilds() {
    this.subscriptionManager.subscribeToChannel(Channel.Guild, ({ operation, ...args }) => {
      switch(operation) {
        case GuildChannelOperation.Add: {
          this.createGuild(args.guildName);
          break;
        }

        case GuildChannelOperation.AddMember: {
          this.joinGuild(args.name, args.guildName, args.tier);
          break;
        }

        case GuildChannelOperation.RemoveMember: {
          this.leaveGuild(args.name, args.guildName);
          break;
        }

        case GuildChannelOperation.Update: {
          this.updateGuild(args.guildName, args.key, args.value);
          break;
        }

        case GuildChannelOperation.GiveItem: {
          this.shareItem(args.guildName, args.item);
          break;
        }

        case GuildChannelOperation.GiveScroll: {
          this.shareItem(args.guildName, args.scroll);
          break;
        }
      }
    });
  }

  private async loadGuilds() {
    const guilds = await this.db.loadGuilds();
    guilds.forEach(guild => {
      this.addGuild(guild);
      this.checkDiscordUpgradeForGuild(guild);
    });
  }

  private addGuild(guild: Guild): void {
    this.guilds[guild.name] = guild;
  }

  public getGuild(guildName: string): Guild {
    return this.guilds[guildName];
  }

  private async saveGuild(guild: Guild) {
    return this.db.saveGuild(guild);
  }

  public async createGuildObject(owner: string, name: string, tag: string): Promise<Guild> {
    const guild = new Guild();
    guild.name = name;
    guild.tag = tag;

    guild.init();

    // first, try to add the guild to the database - checks indexes
    await this.saveGuild(guild);

    this.addGuild(guild);

    this.joinGuild(owner, name, GuildMemberTier.Leader);

    await this.saveGuild(guild);

    this.initiateCreateGuild(name);

    return guild;
  }

  private initiateCreateGuild(guildName: string) {
    this.subscriptionManager.emitToChannel(Channel.Guild, { operation: GuildChannelOperation.Add, guildName });
  }

  private async createGuild(guildName) {
    const guild = await this.db.loadGuild(guildName);
    if(!guild) return;

    this.addGuild(guild);
  }

  public initiateJoinGuild(name: string, guildName: string, tier: GuildMemberTier) {
    this.subscriptionManager.emitToChannel(Channel.Guild, {
      operation: GuildChannelOperation.AddMember, name, guildName, tier
    });
  }

  public initiateLeaveGuild(name: string, guildName: string) {
    this.subscriptionManager.emitToChannel(Channel.Guild, {
      operation: GuildChannelOperation.RemoveMember, name, guildName
    });
  }

  public joinGuild(name: string, guildName: string, tier: GuildMemberTier) {

    const guild = this.getGuild(guildName);
    if(!guild) throw new Error(`Guild ${guildName} does not exist; cannot join it.`);

    guild.addMember(name, tier);
    this.saveGuild(guild);

    const player = this.playerManager.getPlayer(name);
    if(!player) return;

    player.guildName = guildName;
    this.discordManager.addGuildRole(player);
    player.$$game.updatePlayer(player);

    this.db.clearAppsInvitesForPlayer(player.name);
  }

  public async leaveGuild(name: string, guildName: string) {
    const guild = this.getGuild(guildName);
    if(!guild) throw new Error(`Guild ${guildName} does not exist; cannot leave it.`);

    guild.removeMember(name);
    this.saveGuild(guild);

    const player = this.playerManager.getPlayer(name);
    if(!player) return;

    await this.discordManager.removeGuildRole(player);
    player.guildName = '';
    player.$$game.updatePlayer(player);
  }

  public updateGuildKey(guildName: string, key: string, value: any): void {
    this.updateGuild(guildName, key, value);
    this.saveGuild(this.getGuild(guildName));

    this.subscriptionManager.emitToChannel(Channel.Guild, {
      operation: GuildChannelOperation.Update,
      guildName, key, value
    });
  }

  private updateGuild(guildName: string, key: string, value: any): void {
    const guild = this.getGuild(guildName);
    if(!guild) return;

    set(guild, key, value);
  }

  public getGuildForPlayer(player: Player): Guild {
    if(player.guildName) {
      const guild = this.getGuild(player.guildName);
      return guild;
    }
  }

  public initiateShareItem(guildName: string, item: IItem) {
    this.subscriptionManager.emitToChannel(Channel.Guild, {
      operation: GuildChannelOperation.GiveItem,
      guildName,
      item
    });
  }

  public shareItem(guildName: string, itemData: IItem) {

    const guild = this.getGuild(guildName);
    if(!guild) return;

    Object.keys(guild.members).forEach(member => {
      const player = this.playerManager.getPlayer(member);
      if(!player) return;

      const item = new Item();
      item.init(itemData);
      item.regenerateUUID();

      this.eventManager.doEventFor(player, EventName.FindItem, { fromGuild: true, item });
    });
  }

  public initiateShareScroll(guildName: string, scroll: IBuffScrollItem) {
    this.subscriptionManager.emitToChannel(Channel.Guild, {
      operation: GuildChannelOperation.GiveScroll,
      guildName,
      scroll
    });
  }

  public shareScroll(guildName: string, scroll: IBuffScrollItem) {

    const guild = this.getGuild(guildName);
    if(!guild) return;

    Object.keys(guild.members).forEach(member => {
      const player = this.playerManager.getPlayer(member);
      if(!player) return;

      player.$inventory.addBuffScroll(scroll);
    });
  }

  public checkDiscordUpgradeForGuild(guild: Guild) {
    if(guild.buildingLevels[GuildBuilding.Crier] < 1) return;

    this.discordManager.createDiscordChannelForGuild(guild);
  }

}
