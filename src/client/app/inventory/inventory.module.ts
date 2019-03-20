import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Routes, RouterModule } from '@angular/router';

import { IonicModule } from '@ionic/angular';

import { InventoryPage } from './inventory.page';
import { SharedModule } from '../shared.module';

import { InventoryItemPopover } from './item.popover';

const routes: Routes = [
  {
    path: '',
    component: InventoryPage
  }
];

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    RouterModule.forChild(routes),

    SharedModule
  ],
  entryComponents: [InventoryItemPopover],
  declarations: [InventoryItemPopover, InventoryPage]
})
export class InventoryPageModule {}