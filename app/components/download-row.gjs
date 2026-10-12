import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import Icon from './icon';

// One file in a list of downloads: its name, what it is, and how the save is
// going. @row is { key, icon, label, meta } joined with DownloadJobs.view().
<template>
  <li class="vd-format {{if @row.failed 'is-failed'}}">
    <Icon @name={{@row.icon}} @size={{16}} />
    <div class="vd-format-info">
      <span class="vd-format-label">{{@row.label}}</span>
      {{#if @row.meta}}
        <span class="vd-format-meta">{{@row.meta}}</span>
      {{/if}}
      {{#if @row.going}}
        {{#if @row.hasTotal}}
          <progress
            class="tool-progress"
            value={{@row.fraction}}
            max="1"
            aria-label="Download progress"
          ></progress>
        {{else}}
          <progress
            class="tool-progress"
            aria-label="Working, length unknown"
          ></progress>
        {{/if}}
      {{/if}}
      {{#if @row.status}}
        <span class="vd-format-status" aria-live="polite">{{@row.status}}</span>
      {{/if}}
      {{#if @row.error}}
        <span class="tool-error" role="alert">{{@row.error}}</span>
      {{/if}}
    </div>
    {{#if @row.going}}
      <button type="button" class="btn" {{on "click" (fn @onCancel @row)}}>
        <Icon @name="x" @size={{13}} />
        Cancel
      </button>
    {{else}}
      <button
        type="button"
        class="btn active"
        disabled={{@disabled}}
        {{on "click" (fn @onSave @row)}}
      >
        <Icon @name="download" @size={{13}} />
        {{if @row.done "Save again" "Save"}}
      </button>
    {{/if}}
  </li>
</template>
