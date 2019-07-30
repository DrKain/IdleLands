import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { decompress } from 'lzutf8';

import { ICombat } from '../../../shared/interfaces';
import { CombatAction, CombatSimulator } from '../../../shared/combat/combat-simulator';

@Component({
  selector: 'app-combat',
  templateUrl: './combat.page.html',
  styleUrls: ['./combat.page.scss'],
})
export class CombatPage implements OnInit {

  public isLoaded: boolean;

  public combat: ICombat;
  public combatAnte = { xp: 0, gold: 0 };
  public combatMessages: Array<{ message: string, data?: ICombat }> = [];
  public summaryMessages: string[] = [];

  constructor(
    private router: Router,
    private activatedRoute: ActivatedRoute
  ) { }

  ngOnInit() {
    const combat = this.activatedRoute.snapshot.paramMap.get('combatData');

    try {
      const combatData = JSON.parse(decompress(combat, { inputEncoding: 'Base64' }));
      this.combat = combatData;
    } catch(e) {
      this.router.navigate(['/home']);
      return;
    }

    setTimeout(() => {
      this.beginCombat();
    }, 1000);
  }

  private beginCombat() {

    this.combatAnte.xp = Object.values(this.combat.ante).reduce((prev, cur) => prev + cur.xp, 0);
    this.combatAnte.gold = Object.values(this.combat.ante).reduce((prev, cur) => prev + cur.gold, 0);

    const simulator = new CombatSimulator(this.combat);
    simulator.events$.subscribe(({ action, data }) => {
      if(action === CombatAction.Message) {
        this.combatMessages.push({ message: data });
      }

      if(action === CombatAction.PrintStatistics) {
        this.combatMessages.push({ message: '__summary', data });
      }

      if(action === CombatAction.SummaryMessage) {
        this.summaryMessages.push(data);
      }

      if(action === CombatAction.Victory) {
        this.isLoaded = true;
      }
    });

    simulator.beginCombat();
  }

}
