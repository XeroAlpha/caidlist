const { cachedOutput, forEachObject } = require("../util/common");

const userTranslationStorageKey = {
    glossary: "translation.glossary",
    command: "translation.command",
    block: "translation.block",
    item: "translation.item",
    sound: "translation.sound",
    entity: "translation.entity",
    entityEvent: "translation.entity_event",
    entityFamily: "translation.entity_family",
    particleEmitter: "translation.particle_emitter",
    animation: "translation.animation",
    animationController: "translation.animation_controller",
    effect: "translation.effect",
    enchant: "translation.enchant",
    fog: "translation.fog",
    location: "translation.location",
    biome: "translation.biome",
    damageCause: "translation.damage_cause",
    gamerule: "translation.gamerule",
    entitySlot: "translation.entity_slot",
    feature: "translation.feature",
    lootTable: "translation.loot_table",
    langParity: "translation.lang_parity"
};
function loadUserTranslation() {
    let userTranslation = {};
    forEachObject(userTranslationStorageKey, (v, k) => {
        userTranslation[k] = cachedOutput(v, () => new Object());
    });
    return userTranslation;
}

function saveUserTranslation(userTranslation) {
    forEachObject(userTranslationStorageKey, (v, k) => {
        cachedOutput(v, userTranslation[k]);
    });
}

module.exports = {
    loadUserTranslation,
    saveUserTranslation
};
