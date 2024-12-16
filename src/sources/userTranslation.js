import { cachedOutput, forEachObject } from '../util/common.js';

const userTranslationStorageKey = {
    glossary: 'translation.glossary',
    command: 'translation.command',
    block: 'translation.block',
    blockState: 'translation.block_state',
    blockTag: 'translation.block_tag',
    item: 'translation.item',
    itemTag: 'translation.item_tag',
    sound: 'translation.sound',
    entity: 'translation.entity',
    entityEvent: 'translation.entity_event',
    entityFamily: 'translation.entity_family',
    particleEmitter: 'translation.particle_emitter',
    animation: 'translation.animation',
    animationController: 'translation.animation_controller',
    effect: 'translation.effect',
    enchant: 'translation.enchant',
    fog: 'translation.fog',
    location: 'translation.location',
    biome: 'translation.biome',
    damageCause: 'translation.damage_cause',
    gamerule: 'translation.gamerule',
    entitySlot: 'translation.entity_slot',
    ability: 'translation.ability',
    feature: 'translation.feature',
    featureRule: 'translation.feature_rule',
    inputPermission: 'translation.input_permission',
    cameraPreset: 'translation.camera_preset',
    recipe: 'translation.recipe',
    hudElement: 'translation.hud_element',
    lootTable: 'translation.loot_table',
    cooldownCategory: 'translation.cooldown_category',
    langParity: 'translation.lang_parity',
    documentation: 'translation.documentation'
};

export function loadUserTranslation() {
    const userTranslation = {};
    forEachObject(userTranslationStorageKey, (v, k) => {
        userTranslation[k] = cachedOutput(v, () => ({}));
    });
    return userTranslation;
}

export function saveUserTranslation(userTranslation) {
    forEachObject(userTranslationStorageKey, (v, k) => {
        cachedOutput(v, userTranslation[k]);
    });
}
