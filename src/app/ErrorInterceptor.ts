import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpHandler, HttpRequest, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable()
export class ErrorInterceptor implements HttpInterceptor {
	intercept(request: HttpRequest<any>, next: HttpHandler): Observable<any> {
		return next.handle(request).pipe(
			catchError((error: HttpErrorResponse) => {
				// Handle the error here
				let err = error;
				while (err.error) {
					err = err.error;
				}

				const errorMessage = err.message || 'An error occurred';
				console.error(errorMessage);
				alert(errorMessage);

				// You can also log the error to the console or perform other actions as needed

				return throwError(error);
			})
		);
	}
}
