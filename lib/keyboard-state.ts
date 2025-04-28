/**
 * @author Lee Stemkoski
 *
 * Usage:
 * (1) create a global variable:
 *      const keyboard = new KeyboardState();
 * (2) during main loop:
 *       keyboard.update();
 * (3) check state of keys:
 *       keyboard.down("A")    -- true for one update cycle after key is pressed
 *       keyboard.pressed("A") -- true as long as key is being pressed
 *       keyboard.up("A")      -- true for one update cycle after key is released
 *
 *  See KeyboardState.k object data below for names of keys whose state can be polled
 */

// Define the interface for key status
interface KeyStatus {
	down: boolean;
	pressed: boolean;
	up: boolean;
	updatedPreviously: boolean;
}

// Define the KeyboardState class
class KeyboardState {
	private static k: Record<number, string> = {
		8: "backspace", 9: "tab", 13: "enter", 16: "shift",
		17: "ctrl", 18: "alt", 27: "esc", 32: "space",
		33: "pageup", 34: "pagedown", 35: "end", 36: "home",
		37: "left", 38: "up", 39: "right", 40: "down",
		45: "insert", 46: "delete", 186: ";", 187: "=",
		188: ",", 189: "-", 190: ".", 191: "/",
		219: "[", 220: "\\", 221: "]", 222: "'"
	};

	private static status: Record<string, KeyStatus> = {};

	constructor() {
		// Bind key events
		document.addEventListener("keydown", KeyboardState.onKeyDown, false);
		document.addEventListener("keyup", KeyboardState.onKeyUp, false);
	}

	private static keyName(keyCode: number): string {
		return KeyboardState.k[keyCode] ?? String.fromCharCode(keyCode);
	}

	private static onKeyUp(event: KeyboardEvent): void {
		const key = KeyboardState.keyName(event.keyCode);
		if (KeyboardState.status[key]) {
			KeyboardState.status[key].pressed = false;
		}
	}

	private static onKeyDown(event: KeyboardEvent): void {
		const key = KeyboardState.keyName(event.keyCode);
		if (!KeyboardState.status[key]) {
			KeyboardState.status[key] = {
				down: false,
				pressed: false,
				up: false,
				updatedPreviously: false
			};
		}
	}

	public update(): void {
		for (const key in KeyboardState.status) {
			const keyStatus = KeyboardState.status[key];

			// Ensure that every keypress has "down" status exactly once
			if (!keyStatus.updatedPreviously) {
				keyStatus.down = true;
				keyStatus.pressed = true;
				keyStatus.updatedPreviously = true;
			} else {
				keyStatus.down = false;
			}

			// Key has been flagged as "up" since last update
			if (keyStatus.up) {
				delete KeyboardState.status[key];
				continue;
			}

			if (!keyStatus.pressed) {
				keyStatus.up = true;
			}
		}
	}

	public down(keyName: string): boolean {
		return !!KeyboardState.status[keyName]?.down;
	}

	public pressed(keyName: string): boolean {
		return !!KeyboardState.status[keyName]?.pressed;
	}

	public up(keyName: string): boolean {
		return !!KeyboardState.status[keyName]?.up;
	}

	public debug(): void {
		const activeKeys = Object.keys(KeyboardState.status).join(" ");
		console.log(`Keys active: ${activeKeys}`);
	}
}

export default KeyboardState;
