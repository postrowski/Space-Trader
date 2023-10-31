import { AfterViewInit, Injectable } from "@angular/core";
import { LocXY } from "src/models/LocXY";

@Injectable({
  providedIn: 'root' // Or another Angular module where you want to provide this utility
})
export abstract class SvgMap implements AfterViewInit {
   	zoomFactor = 1.4; // Adjust the zoom factor as needed
	width = 600;
	height = 600;
	scale: number = 1;
	baseScale: number = 1;
	xOffset: number = this.width/2;
	yOffset: number = this.height/2;
	componentName!: string;
	objectScale = 1;
	baseObjectScale = 1;
	
	constructor() {
	}
	
	// This method will be called anytime the scale factor change
    abstract onScale(): void;
    
	ngAfterViewInit(): void {
		const svgElement = document.getElementById(this.componentName);
		if (svgElement) {
			svgElement.addEventListener("wheel", (event: WheelEvent) => {
				if (!event.ctrlKey) {
					return;
				}
				event.preventDefault();
				let zoomIn: boolean = (event.deltaY < 0);
				if (!zoomIn && this.scale <= this.baseScale) {
					this.xOffset = this.width/2;
					this.yOffset = this.height/2;
					this.scale = this.baseScale;
					return;
				}
				const svgElement = event.currentTarget as SVGSVGElement; // Get the SVG element that triggered the event
				if (svgElement) {

					// Get the SVG element's bounding rectangle
					const svgRect = svgElement.getBoundingClientRect();

					// Calculate the relative coordinates inside the SVG element
					const relativeX = event.clientX - svgRect.left;
					const relativeY = event.clientY - svgRect.top;

					const unscaledX = (relativeX-this.xOffset) / this.scale;
					const unscaledY = (relativeY-this.yOffset) / this.scale;

					// Calculate the new scale factor
					this.scale *= zoomIn ? this.zoomFactor : 1 / this.zoomFactor;

					this.xOffset = relativeX - unscaledX * this.scale;
					this.yOffset = relativeY - unscaledY * this.scale;

					// as we are more zoomed in, increase the radius of the stars,
					// but not by the same scale factor.
					this.objectScale = this.baseObjectScale * Math.pow(this.scale / this.baseScale, .3);

					this.onScale();
				}
			});
		}
	}
	
	mouseDownX: number | null = null;
	mouseDownY: number | null = null;
	originalOffsetX: number | null = null;
	originalOffsetY: number | null = null;
	onMouseDown(event: MouseEvent) {
		this.originalOffsetX = this.xOffset;
		this.originalOffsetY = this.yOffset;
		this.mouseDownX = event.clientX;
		this.mouseDownY = event.clientY;
	}
	onMouseUp(event: MouseEvent) {
		this.mouseDownX = null;
		this.mouseDownY = null;
		this.originalOffsetX = null;
		this.originalOffsetY = null;
	}
	onMouseLeave(event: MouseEvent) {
		if (this.originalOffsetX && this.originalOffsetY) {
			this.xOffset = this.originalOffsetX;
			this.yOffset = this.originalOffsetY;
		}
	}
	onMouseEnter(event: MouseEvent) {}

	onMouseMove(event: MouseEvent) {
		if (this.mouseDownX && this.mouseDownY && this.originalOffsetX && this.originalOffsetY) {
			if (event.buttons == 1) {
				let moveX = event.clientX - this.mouseDownX;
				let moveY = event.clientY - this.mouseDownY;
				this.xOffset = this.originalOffsetX + moveX;
				this.yOffset = this.originalOffsetY + moveY;
			} else {
				this.onMouseUp(event);
			}
		}
	}
	
	centerOnLocation(x: number, y: number) {
		this.animationStartLoc = new LocXY(this.xOffset, this.yOffset);
		this.animationStopLoc = new LocXY(this.width/2 - x * this.scale, this.height/2 - y* this.scale);
		const dx = Math.abs(this.animationStartLoc.x - this.animationStopLoc.x);
		const dy = Math.abs(this.animationStartLoc.x - this.animationStopLoc.x);
		if ((dx > this.width/2) || (dy > this.height/2)) {
			this.animate();
		}
	}
	
	locationAnimation: any;
	animationStartLoc: LocXY | undefined;
	animationStopLoc: LocXY | undefined;
	animationBegin: number | undefined;
	animationDuration = 1500; // in milliseconds

	private stopAnimation() {
		if (this.locationAnimation) {
			clearInterval(this.locationAnimation);
			this.locationAnimation = null;
		}
	}
	easeInOutCubic(t : number) {
		return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
	}
	
	private animate() {
		this.stopAnimation();
		this.animationBegin = Date.now();
		this.locationAnimation = setInterval(() => {
			if (this.animationBegin && this.animationStopLoc && this.animationStartLoc) {
				let t = (Date.now() - this.animationBegin) / this.animationDuration;
				t = Math.min(Math.max(t, 0), 1);
				const tt = this.easeInOutCubic(t);
				this.xOffset = this.animationStartLoc.x + (this.animationStopLoc.x - this.animationStartLoc.x) * tt;
				this.yOffset = this.animationStartLoc.y + (this.animationStopLoc.y - this.animationStartLoc.y) * tt;
				if (t >= 1) {
					this.stopAnimation();
				}
			}
		}, 100);
	}
}
