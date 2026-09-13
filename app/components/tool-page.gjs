import FavouriteStar from './favourite-star';
import CreditList from './credit-list';
import { TOOLS } from '../tools';

const toolFor = (route) => TOOLS.find((t) => t.route === route);

<template>
  {{#let (toolFor @route) as |tool|}}
    <div class="container">
      <section class="hero pop-in">
        <h1 class="hero-title">
          <span>{{tool.label}}</span>
          <FavouriteStar @route={{@route}} @size={{20}} />
        </h1>
        <p>{{@subtitle}}</p>
      </section>

      <div class="tool-body">
        {{yield}}
      </div>

      <section class="made-with pop-in">
        <h2 class="section-title">How it's made</h2>
        <p>{{tool.madeWith}}</p>
        {{#if tool.credits.length}}
          <h3 class="credit-heading">Libraries</h3>
          <CreditList @credits={{tool.credits}} />
        {{/if}}
      </section>
    </div>
  {{/let}}
</template>
