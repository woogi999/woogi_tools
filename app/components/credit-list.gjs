<template>
  <ul class="credit-list">
    {{#each @credits as |credit|}}
      <li>
        <a href={{credit.url}} target="_blank" rel="noopener noreferrer">{{credit.name}}</a>
        {{#if credit.author}}<span class="credit-meta"> by {{credit.author}}</span>{{/if}}
        {{#if credit.license}}<span class="credit-meta"> · {{credit.license}}</span>{{/if}}
      </li>
    {{/each}}
  </ul>
</template>
