import { UnitSystem } from './UnitSystem';
import type { GameUnit } from '../../types';

interface MusicState {
    source: AudioBufferSourceNode;
    gainNode: GainNode;
    isPlaying: boolean;
}

class AudioSystem {
    static audioContext: AudioContext | null = null;
    static sounds = new Map<string, AudioBuffer>();
    static music: MusicState | null = null;
    static initialized = false;
    static FADE_DURATION = 0.2; // Duration of fade in/out in seconds

    static async initialize() {
        if (this.initialized) return;

        // Create audio context
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // Load sound effects
        await this.loadSound('rlauncher1', 'assets/sounds/rlauncher.ogg');
        await this.loadSound('rlauncher2', 'assets/sounds/rlauncher2.ogg');
        await this.loadSound('rlauncher3', 'assets/sounds/rlauncher3.ogg');
        await this.loadSound('explosion', 'assets/sounds/explosion.ogg');
        await this.loadSound('engine_heavy', 'assets/sounds/engine_heavy_loop.mp3');
        await this.loadSound('engine_light', 'assets/sounds/Car_Engine_Loop.ogg');
        await this.loadSound('step1', 'assets/sounds/step_lth33.ogg');
        await this.loadSound('battleship_movement', 'assets/sounds/BattleShipMovementAmbient.ogg');
        await this.loadSound('jet', 'assets/sounds/jet.wav');
        // Tank main gun: a launcher's thump, not the rocket's jet whoosh.
        await this.loadSound('cannon', 'assets/sounds/glauncher.ogg');
        // No helicopter sample ships with the project, so the rotor is
        // synthesised rather than loaded.
        this.sounds.set('rotor', this.createRotorBuffer());

        this.initialized = true;
    }

    // Builds a looping rotor sound from scratch: the blade-pass chop, the
    // broadband wash of the disc, and a turbine note under it.
    //
    // It has to loop seamlessly, so every component is given a whole number
    // of cycles inside the buffer -- a chop rate that divides evenly into
    // the duration, and turbine partials at exact multiples of 1/duration.
    // Anything else clicks audibly once per loop.
    static createRotorBuffer(): AudioBuffer {
        const context = this.audioContext!;
        const rate = context.sampleRate;
        const duration = 1;                       // seconds
        const frames = Math.floor(rate * duration);
        const buffer = context.createBuffer(1, frames, rate);
        const out = buffer.getChannelData(0);

        const chopsPerLoop = 16;                  // whole number => seamless
        const turbineLow = 190;                   // both integers, so they
        const turbineHigh = 377;                  // also close the loop

        // One-pole low-pass state for the wash.
        let washState = 0;

        for (let i = 0; i < frames; i++) {
            const t = i / rate;

            // Blade pass: a sharp attack that decays before the next blade.
            const chopPhase = (t * chopsPerLoop) % 1;
            const chop = Math.exp(-chopPhase * 7) - Math.exp(-7);

            // Rotor wash: white noise smoothed into a dull roar.
            const noise = Math.random() * 2 - 1;
            washState += (noise - washState) * 0.06;

            const turbine =
                0.05 * Math.sin(2 * Math.PI * turbineLow * t) +
                0.03 * Math.sin(2 * Math.PI * turbineHigh * t);

            // The chop gates most of the wash, which is what makes it read
            // as a rotor rather than as wind.
            out[i] = (washState * (0.35 + 0.65 * chop) * 1.6 + chop * 0.22 + turbine) * 0.6;
        }

        return buffer;
    }

    static async loadSound(name: string, url: string) {
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);
            this.sounds.set(name, audioBuffer);
        } catch (error) {
            console.error(`Error loading sound ${name}:`, error);
        }
    }

    static async loadMusic(url: string) {
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);

            // Create a source node
            const source = this.audioContext!.createBufferSource();
            source.buffer = audioBuffer;

            // Create a gain node for volume control
            const gainNode = this.audioContext!.createGain();
            gainNode.gain.value = 0.5; // Set default volume to 50%

            // Connect nodes
            source.connect(gainNode);
            gainNode.connect(this.audioContext!.destination);

            // Store the source and gain node
            this.music = {
                source,
                gainNode,
                isPlaying: false
            };

        } catch (error) {
            console.error('Error loading music:', error);
        }
    }

    static playSound(name: string, volume: number = 1.0, duration: number | null = null) {
        const sound = this.sounds.get(name);
        if (sound) {
            const source = this.audioContext!.createBufferSource();
            const gainNode = this.audioContext!.createGain();

            source.buffer = sound;
            gainNode.gain.value = volume;

            source.connect(gainNode);
            gainNode.connect(this.audioContext!.destination);

            source.start(0);

            // If duration is specified, stop the sound after that duration
            if (duration !== null) {
                setTimeout(() => {
                    source.stop();
                }, duration);
            }
        }
    }

    static playMusic(loop: boolean = true) {
        if (this.music && !this.music.isPlaying) {
            this.music.source.loop = loop;
            this.music.source.start(0);
            this.music.isPlaying = true;
        }
    }

    static stopMusic() {
        if (this.music && this.music.isPlaying) {
            this.music.source.stop();
            this.music.isPlaying = false;
        }
    }

    static setMusicVolume(volume: number) {
        if (this.music) {
            this.music.gainNode.gain.value = volume;
        }
    }

    static playEngineSound(unit: GameUnit) {
        // Stop any existing engine sound for this unit
        if (unit.engineSound) {
            this.stopEngineSound(unit);
        }

        // Get the unit type's movement sound configuration
        const unitType = (UnitSystem.unitTypes as any)[unit.type];
        if (!unitType || !unitType.sounds || !unitType.sounds.movement) {
            return; // No movement sound configured for this unit type
        }

        // Create a new source for this unit's movement sound
        const source = this.audioContext!.createBufferSource();
        const gainNode = this.audioContext!.createGain();

        source.buffer = this.sounds.get(unitType.sounds.movement) ?? null;
        if (!source.buffer) {
            console.warn(`Movement sound ${unitType.sounds.movement} not found for unit type ${unit.type}`);
            return;
        }

        source.loop = true; // Loop the movement sound
        gainNode.gain.value = 0; // Start at 0 volume

        source.connect(gainNode);
        gainNode.connect(this.audioContext!.destination);

        // Store the source and gain node in the unit for later cleanup
        unit.engineSound = {
            source,
            gainNode
        };

        // Start the sound
        source.start(0);

        // Fade in
        gainNode.gain.setTargetAtTime(0.3, this.audioContext!.currentTime, this.FADE_DURATION);
    }

    static stopEngineSound(unit: GameUnit) {
        if (unit.engineSound) {
            const { source, gainNode } = unit.engineSound;

            // Fade out
            gainNode.gain.setTargetAtTime(0, this.audioContext!.currentTime, this.FADE_DURATION);

            // Stop the source after the fade out
            setTimeout(() => {
                source.stop();
                unit.engineSound = null;
            }, this.FADE_DURATION * 1000); // Convert to milliseconds
        }
    }

    static playAttackSound(unit: GameUnit) {
        const unitType = (UnitSystem.unitTypes as any)[unit.type];
        if (!unitType || !unitType.sounds || !unitType.sounds.attack) {
            return; // No attack sound configured for this unit type
        }

        this.playSound(unitType.sounds.attack, 0.8);
    }
}

export { AudioSystem };