// a function to roll a dice with n faces
export function dice(faces) {
    return Math.floor(Math.random() * faces) + 1;
}

// a list of skills and their characteristic
export const skillList = {
    "acrobatics": "dex",
    "animalHandling": "wis",
    "arcana": "int",
    "athletics": "str",
    "deception": "cha",
    "history": "int",
    "insight": "wis",
    "intimidation": "cha",
    "investigation": "int",
    "medicine": "wis",
    "nature": "int",
    "perception": "wis",
    "performance": "cha",
    "persuasion": "cha",
    "religion": "int",
    "sleightOfHand": "dex",
    "stealth": "dex",
    "survival": "wis"
};

// a list of the base characteristics for iterations
export const baseCharacteristics = [
    "str",
    "dex",
    "con",
    "wis",
    "int",
    "cha"
];

// the names of every class
export const classNames = [
    "barbarian",
    /*"bard",
    "cleric",
    "druid",
    "fighter",
    "monk",
    "paladin",
    "ranger",
    "rogue",
    "sorcerer",
    "warlock",
    "wizard"*/
];

// a list of valid colors
export const validColors = [
    "black", "veryDarkGrey", "darkGrey", "grey", "lightGrey", "veryLightGrey", "white",
    "red", "lightRed", "veryLightRed", "darkRed", "veryDarkRed", "greyRed",
    "orange", "lightOrange", "veryLightOrange", "darkOrange", "veryDarkOrange", "greyOrange",
    "yellow", "lightYellow", "veryLightYellow", "darkYellow", "veryDarkYellow", "greyYellow",
    "green", "lightGreen", "veryLightGreen", "darkGreen", "veryDarkGreen", "greyGreen",
    "cyan", "lightCyan", "veryLightCyan", "darkCyan", "veryDarkCyan", "greyCyan",
    "blue", "lightBlue", "veryLightBlue", "darkBlue", "veryDarkBlue", "greyBlue",
    "purple", "lightPurple", "veryLightPurple", "darkPurple", "veryDarkPurple", "greyPurple",
    "pink", "lightPink", "veryLightPink", "darkPink", "veryDarkPink", "greyPink"
];

// a function to calculate the modifier (ex- +4) from a stat (ex- 18)
export function modifier(stat) {
    return Math.floor(stat/2) - 5;
}

// checks if a value is within the specified parameters
export function sanitize(value, type, p) {
    switch(type) {
        case "float": {
            value = parseFloat(value);
            if (isNaN(value)) return p.default;
            if (p.min) value = Math.max(p.min, value);
            if (p.max) value = Math.min(p.max, value);
            if (p.round) value = Math.round(value / p.round) * p.round;
            return value;
        }
        case "string": {
            value = String(value);
            if (value.length === 0) return p.default;
            return value.substring(0, p.max);
        }
        case "color": {
            if (validColors.indexOf(value) === -1) return p.default;
            return value;
        }
        case "option": {
            if (p.valid.indexOf(value) === -1) return p.default;
            return value;
        }
    }
}