import { Component, OnInit } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AccountService } from './services/account.service';
import { ModalService } from './services/modal.service';

@Component({
	selector: 'app-root',
	templateUrl: './app.component.html',
	styleUrls: ['./app.component.css']
})
export class AppComponent {
	title = 'space-trader';
	constructor(private http: HttpClient,
				public accountService: AccountService,
	            public modalService: ModalService) { }
	ngOnInit() {
	}
}
