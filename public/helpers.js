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
    "bard",
    "cleric",
    "druid",
    "fighter",
    "monk",
    "paladin",
    "ranger",
    "rogue",
    "sorcerer",
    "warlock",
    "wizard"
];

// a function to calculate the modifier (ex- +4) from a stat (ex- 18)
export function modifier(stat) {
    return Math.floor(stat/2) - 5;
}