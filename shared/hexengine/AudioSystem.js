class AudioSystem {
    static audioContext = null;
    static sounds = new Map();
    static music = null;
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

        this.initialized = true;
        console.log('AudioSystem initialized');
    }

    static async loadSound(name, url) {
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            this.sounds.set(name, audioBuffer);
            console.log(`Loaded sound: ${name}`);
        } catch (error) {
            console.error(`Error loading sound ${name}:`, error);
        }
    }

    static async loadMusic(url) {
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            // Create a source node
            const source = this.audioContext.createBufferSource();
            source.buffer = audioBuffer;

            // Create a gain node for volume control
            const gainNode = this.audioContext.createGain();
            gainNode.gain.value = 0.5; // Set default volume to 50%

            // Connect nodes
            source.connect(gainNode);
            gainNode.connect(this.audioContext.destination);

            // Store the source and gain node
            this.music = {
                source,
                gainNode,
                isPlaying: false
            };

            console.log('Loaded music');
        } catch (error) {
            console.error('Error loading music:', error);
        }
    }

    static playSound(name, volume = 1.0, duration = null) {
        const sound = this.sounds.get(name);
        if (sound) {
            const source = this.audioContext.createBufferSource();
            const gainNode = this.audioContext.createGain();

            source.buffer = sound;
            gainNode.gain.value = volume;

            source.connect(gainNode);
            gainNode.connect(this.audioContext.destination);

            source.start(0);

            // If duration is specified, stop the sound after that duration
            if (duration !== null) {
                setTimeout(() => {
                    source.stop();
                }, duration);
            }
        }
    }

    static playMusic(loop = true) {
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

    static setMusicVolume(volume) {
        if (this.music) {
            this.music.gainNode.gain.value = volume;
        }
    }

    static playEngineSound(unit) {
        // Stop any existing engine sound for this unit
        if (unit.engineSound) {
            this.stopEngineSound(unit);
        }

        // Get the unit type's movement sound configuration
        const unitType = UnitSystem.unitTypes[unit.type];
        if (!unitType || !unitType.sounds || !unitType.sounds.movement) {
            return; // No movement sound configured for this unit type
        }

        // Create a new source for this unit's movement sound
        const source = this.audioContext.createBufferSource();
        const gainNode = this.audioContext.createGain();

        source.buffer = this.sounds.get(unitType.sounds.movement);
        if (!source.buffer) {
            console.warn(`Movement sound ${unitType.sounds.movement} not found for unit type ${unit.type}`);
            return;
        }

        source.loop = true; // Loop the movement sound
        gainNode.gain.value = 0; // Start at 0 volume

        source.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        // Store the source and gain node in the unit for later cleanup
        unit.engineSound = {
            source,
            gainNode
        };

        // Start the sound
        source.start(0);

        // Fade in
        gainNode.gain.setTargetAtTime(0.3, this.audioContext.currentTime, this.FADE_DURATION);
    }

    static stopEngineSound(unit) {
        if (unit.engineSound) {
            const { source, gainNode } = unit.engineSound;

            // Fade out
            gainNode.gain.setTargetAtTime(0, this.audioContext.currentTime, this.FADE_DURATION);

            // Stop the source after the fade out
            setTimeout(() => {
                source.stop();
                unit.engineSound = null;
            }, this.FADE_DURATION * 1000); // Convert to milliseconds
        }
    }

    static playAttackSound(unit) {
        const unitType = UnitSystem.unitTypes[unit.type];
        if (!unitType || !unitType.sounds || !unitType.sounds.attack) {
            return; // No attack sound configured for this unit type
        }

        this.playSound(unitType.sounds.attack, 0.8);
    }
}

window.AudioSystem = AudioSystem;
console.log('AudioSystem.js loaded'); 