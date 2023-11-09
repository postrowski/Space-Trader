import { AgentComponent } from './components/agent/agent.component';
import { AppComponent } from './app.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { BrowserModule } from '@angular/platform-browser';
import { ContractComponent } from './components/contract/contract.component';
import { ContractsComponent } from './components/contracts/contracts.component';
import { CountdownComponent } from './components/countdown/countdown.component';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { ErrorInterceptor } from './ErrorInterceptor';
import { FactionComponent } from './components/faction/faction.component';
import { FactionsComponent } from './components/factions/factions.component';
import { FleetComponent } from './components/fleet/fleet.component';
import { FormsModule } from '@angular/forms';
import { GalaxyComponent } from './components/galaxy/galaxy.component';
import { GalaxyMapComponent } from './components/galaxy-map/galaxy-map.component';
import { HTTP_INTERCEPTORS } from '@angular/common/http';
import { HttpClientModule } from '@angular/common/http';
import { JumpgateComponent } from './components/jumpgate/jumpgate.component';
import { MarketplaceComponent } from './components/marketplace/marketplace.component';
import { MatDialogModule } from '@angular/material/dialog';
import { MineComponent } from './components/mine/mine.component';
import { ModalComponent } from './components/modal/modal.component';
import { NgModule } from '@angular/core';
import { RequirementsComponent } from './components/requirements/requirements.component';
import { ShipComponent } from './components/ship/ship.component';
import { ShipyardShipComponent } from './components/shipyardShip/shipyardShip.component';
import { ShipDetailsComponent } from './components/ship-details/ship-details.component';
import { ShipyardComponent } from './components/shipyard/shipyard.component';
import { SystemMapComponent } from './components/system-map/system-map.component';
import { SystemWaypointComponent } from './components/system-waypoint/system-waypoint.component';
import { TimeFormatPipe } from './pipes/time-format.pipe';
import { VerticalProgressBarComponent } from './components/vertical-progress-bar/vertical-progress-bar.component';
import { WaypointBaseComponent } from './components/waypoint-base/waypoint-base.component';
import { AutomationComponent } from './components/automation/automation.component';
import { DiagnosticsComponent } from './components/diagnostics/diagnostics.component';
import { ShiplistComponent } from './components/shiplist/shiplist.component';
import { LeaderboardComponent } from './components/leaderboard/leaderboard.component';
import { SortPipe } from './pipes/AgentSort';
@NgModule({
	declarations: [
		AppComponent,
		AgentComponent,
		ContractComponent,
		ContractsComponent,
	    CountdownComponent,
		FactionComponent,
	    FactionsComponent,
		FleetComponent,
		GalaxyComponent,
	    GalaxyMapComponent,
  		JumpgateComponent,
		MarketplaceComponent,
	    MineComponent,
		ModalComponent,
		RequirementsComponent,
		ShipComponent,
		ShipDetailsComponent,
		ShipyardComponent,
		ShipyardShipComponent,
		SortPipe,
		SystemMapComponent,
		SystemWaypointComponent,
		TimeFormatPipe,
		VerticalProgressBarComponent,
		WaypointBaseComponent,
  AutomationComponent,
  DiagnosticsComponent,
  ShiplistComponent,
  LeaderboardComponent,
	],
	imports: [
		BrowserAnimationsModule,
		BrowserModule,
		DragDropModule,
		FormsModule,
		HttpClientModule,
		MatDialogModule,
	],
	providers: [
		{
			provide: HTTP_INTERCEPTORS,
			useClass: ErrorInterceptor,
			multi: true,
		},
	],
	bootstrap: [AppComponent]
})
export class AppModule { }
