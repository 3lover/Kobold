// This function pulls apart the aspects of a character (class, background, race, items, ect.) and outputs a data json

export function processCharacter(j) {
    const data = {
        // 0-str, 1-dex, 2-con, 3-int, 4-wis, 5-cha
        baseCharacteristics: [0, 0, 0, 0, 0, 0],
        characteristicMods: [0, 0, 0, 0, 0, 0],
    };

    //_ find the base characteristics, and then use that to find the base modifiers for stats
    // first, find the base stats of the character from their starting inputs
    data.baseCharacteristics = Object.values(j.baseCharacteristics);

    // now check our class, and see if we have any stat benefits from it
    for (let c of j.classes) {
        let cref = /* eventually a function */ classData[c.id];
        for (let i = 0; i < 6; i++) {
            data.baseCharacteristics[i] += c.mods[i];
        }
    }

    // now that every stat adjustment is accounted for, create modifiers
    for (let i = 0; i < 6; i++) {
        data.characteristicMods[i] = Math.floor((data.baseCharacteristics[i] - 10) / 2);
    }
}

async function fetchProtocol() {
    let sheet = await (await fetch("./json/defaultCharacterSheet.json")).json();
    processCharacter(sheet);
}

let classData = null;
async function getClassData() {
    classData = [];
    classData = await (await fetch("./json/class-rogue.json")).json();
    
    fetchProtocol();
}
await getClassData();