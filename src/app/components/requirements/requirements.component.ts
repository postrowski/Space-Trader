import { Component, Input } from '@angular/core';
import { ShipRequirements } from 'src/models/ShipRequirements';

@Component({
  selector: 'app-requirements',
  templateUrl: './requirements.component.html',
  styleUrls: ['./requirements.component.css']
})
export class RequirementsComponent {
   @Input() requirements!: ShipRequirements;
}
