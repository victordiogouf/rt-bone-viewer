import { Vector2 } from "three";

export interface PinchEvent {
  scale: number;
  middle: Vector2;
  movement: Vector2;
}

export type PinchType = "pinchstart" | "pinching" | "pinchend";

export class PinchHandler {
  private element: HTMLElement;
  private event_cache: PointerEvent[] = [];
  private prev_distance: number = 0;
  private listeners: { type: PinchType; callback: (e: PinchEvent) => void }[] = [];
  
  constructor(element: HTMLElement) {
    this.element = element;
    this.element.addEventListener("pointerdown", this.handle_pointer_down.bind(this));
    this.element.addEventListener("pointermove", this.handle_pointer_move.bind(this));
    this.element.addEventListener("pointerup", this.handle_pointer_up.bind(this));
    this.element.addEventListener("pointercancel", this.handle_pointer_up.bind(this));
  }

  public add_listener(type: PinchType, callback: (e: PinchEvent) => void) {
    this.listeners.push({ type, callback });
  }

  public notify(type: PinchType, event: PinchEvent) {
    for (const listener of this.listeners) {
      if (listener.type === type) {
        listener.callback(event);
      }
    }
  }

  private handle_pointer_down(event: PointerEvent) {
    this.event_cache.push(event);
    if (this.event_cache.length === 2) {
      this.notify("pinchstart", { scale: 1, middle: new Vector2(0, 0), movement: new Vector2(0, 0) });
    }
  }

  private handle_pointer_move(event: PointerEvent) {
    const index = this.event_cache.findIndex(e => e.pointerId === event.pointerId);
    this.event_cache[index] = event;

    if (this.event_cache.length >= 2) {
      const [event1, event2] = this.event_cache;
      const distance = Math.sqrt(
        Math.pow(event1.clientX - event2.clientX, 2) +
        Math.pow(event1.clientY - event2.clientY, 2)
      );
      
      if (this.prev_distance > 0) {
        const scale = distance / this.prev_distance;
        const middle = new Vector2(
          (event1.clientX + event2.clientX) / 2,
          (event1.clientY + event2.clientY) / 2
        );
        const movement = new Vector2( // amount middle has moved
          event.movementX / 2,
          event.movementY / 2
        );
        this.notify("pinching", { scale, middle, movement });
      }

      this.prev_distance = distance;
    }
  }

  private handle_pointer_up(event: PointerEvent) {
    const index = this.event_cache.findIndex(e => e.pointerId === event.pointerId);
    this.event_cache.splice(index, 1);
    if (index < 2) {
      this.prev_distance = 0; // Reset distance when less than two pointers are down
    }
    if (this.event_cache.length < 2) {
      this.notify("pinchend", { scale: 1, middle: new Vector2(0, 0), movement: new Vector2(0, 0) });
    }
  }
}