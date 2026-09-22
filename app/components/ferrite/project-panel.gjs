import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import Icon from '../icon';

// The Project panel, ported from `ferrite-app/src/ui/panels.rs`.
//
// The scenes in this production, in one flat list with each animation directly
// after the scene it belongs to, so reading straight down it is already the
// right order. All this adds is the indent and a different glyph; the
// ordering is maintained where the list is edited rather than sorted back into
// shape on every frame.
<template>
  <div class="fr-panel-body">
    <div class="fr-head"><Icon @name="layers" @size={{11}} /> SCENES</div>
    <div class="fr-scroll">
      {{#each @editor.sceneRows key="id" as |row|}}
        <div class="fr-scene {{if row.selected 'is-selected'}}">
          <button
            type="button"
            class="fr-scene-name"
            style={{row.indent}}
            {{on "click" (fn @editor.selectScene row.id)}}
          >
            <Icon @name={{if row.animation "spline" "frame"}} @size={{11}} />
            <span>{{row.name}}</span>
            <i class="fr-faint">{{row.duration}}</i>
          </button>
          <button
            type="button"
            class="fr-icon-btn"
            aria-label="Scene properties"
            {{on "click" (fn @editor.openSceneDialog row.id)}}
          ><Icon @name="settings" @size={{11}} /></button>
          <button
            type="button"
            class="fr-icon-btn"
            aria-label="Delete scene"
            {{on "click" (fn @editor.deleteScene row.id)}}
          ><Icon @name="trash-2" @size={{11}} /></button>
        </div>
      {{/each}}
      <div class="fr-scene-actions">
        <button type="button" class="fr-btn" {{on "click" @editor.addScene}}>
          <Icon @name="plus" @size={{11}} />
          New scene</button>
        <button
          type="button"
          class="fr-btn"
          {{on "click" @editor.addSceneAnimation}}
        ><Icon @name="spline" @size={{11}} /> New animation</button>
      </div>
    </div>
  </div>
</template>
