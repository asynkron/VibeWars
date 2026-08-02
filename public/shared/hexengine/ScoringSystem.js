// ScoringSystem.js - Evaluates game state fitness/score for AI decision making
/*
Scoring Formula:
The score for a player is calculated by summing up (HP * Attack Power) for each of their units.
This formula favors:
1. Having multiple units with moderate HP over one unit with high HP
   (e.g., two units at 50% HP > one unit at 100% HP)
2. Keeping powerful units alive (high attack units contribute more to the score)
3. Distributing damage across units rather than focusing on one
   (because a nearly dead unit will likely die next turn and contribute nothing)

Example:
- Unit A: 20 HP, 5 Attack = 100 points
- Unit B: 10 HP, 5 Attack = 50 points
Total Score: 150 points

vs.

- Unit C: 30 HP, 5 Attack = 150 points
- Unit D: 1 HP, 5 Attack = 5 points
Total Score: 155 points

Even though both scenarios have same total HP (30), the first is scored higher
because it's more likely to maintain combat effectiveness in future turns.
*/

class ScoringSystem {
    static calculateScore(gameState, playerIndex) {
        const playerUnits = gameState.getPlayerUnits(playerIndex);

        // Sum up HP * Attack for each unit
        const score = playerUnits.reduce((total, unit) => {
            const unitScore = unit.hp * unit.attack;
            return total + unitScore;
        }, 0);

        return score;
    }

    static getScoreDifference(gameState, playerIndex) {
        // Get score for the specified player
        const playerScore = this.calculateScore(gameState, playerIndex);

        // Get score for all other players combined
        const otherPlayersScore = gameState.players
            .filter(player => player.id !== playerIndex)
            .reduce((total, player) => {
                return total + this.calculateScore(gameState, player.id);
            }, 0);

        // Return the difference (positive means player is winning)
        return playerScore - otherPlayersScore;
    }

    static evaluateMove(gameState, playerIndex) {
        // Clone the game state to simulate the move
        const clonedState = gameState.clone();

        // Calculate the score difference for this state
        return this.getScoreDifference(clonedState, playerIndex);
    }
}

console.log('ScoringSystem.js loaded'); 