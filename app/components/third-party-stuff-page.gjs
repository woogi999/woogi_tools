import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import FavouriteStar from './favourite-star';
import Icon from './icon';

// Things of mine that live somewhere other than this site. To add one, add
// an entry here: `sections` are titled lists, `notes` the fine print.
const STUFF = [
  {
    id: 'arayashiki',
    name: 'Arayashiki',
    kind: 'Windows app',
    tagline: 'The Jujutsu Shenanigans Skill Builder, as a desktop app.',
    intro: [
      'If you make movesets in Jujutsu Shenanigans (the Roblox game), you know the routine: change one number in the Skill Builder, load into a server, try the move, go back and change it again. Arayashiki lets you do most of that outside the game.',
      'You paste your moveset code in, edit it laid out the same way as the in-game builder, and press play to watch the skill run on a 3D character against a training dummy. When it looks right, you copy the code and paste it back into JJS.',
    ],
    links: [
      {
        label: 'Download for Windows',
        icon: 'download',
        primary: true,
        url: 'https://github.com/woogi999/arayashiki/releases/latest/download/Arayashiki-Setup.exe',
      },
      {
        label: 'Source on GitHub',
        icon: 'folder-git-2',
        url: 'https://github.com/woogi999/arayashiki',
      },
    ],
    sections: [
      {
        title: 'What you can do in it',
        items: [
          {
            lead: 'Edit a moveset.',
            text: 'Skills, branches, conditions and every node, with the same fields and tooltips the game shows. Everything can be undone, and anything it doesn’t recognise is left exactly as JJS wrote it, so a code never comes back broken.',
          },
          {
            lead: 'Watch a skill play.',
            text: 'A simulator runs the skill with its effects, hitboxes and sounds. You can scrub to any frame, and a log says which node fired and when. Sign in with Roblox and the character is your own avatar.',
          },
          {
            lead: 'Catch mistakes early.',
            text: 'A Problems tab points out things like a branch that goes nowhere, a hitbox with no damage, or a wait that never ends.',
          },
          {
            lead: 'Start from a template.',
            text: 'A meter, an auto-sheathing weapon, accurate M1s, an accurate dash and percentage damage. These are the templates JJS Stuff had.',
          },
          {
            lead: 'Make meters and effects.',
            text: 'The Meter Maker draws a progress bar frame by frame (it is the old JJS Progress Bar Maker). The FX Maker makes slash, fire, explosion and smoke textures. Both can upload the pictures to your Roblox account and add them to your skill.',
          },
          {
            lead: 'Animate with keyframes.',
            text: 'Move a mesh or the camera around like you would in Blender, and it writes the chain of VISUAL nodes JJS needs.',
          },
          {
            lead: 'Film it.',
            text: 'Export a skill as a video, GIF or picture: slow motion, transparent or green-screen backgrounds, and camera paths you set up by flying around.',
          },
          {
            lead: 'Ask an AI.',
            text: 'There is a chat inside the app that can read and edit the moveset you have open. Bring your own key (Claude, OpenAI, Gemini and others) or run a free local model. It also plugs into Claude Desktop, Cursor and VS Code.',
          },
        ],
      },
      {
        title: 'Good to know',
        items: [
          { text: 'Windows only.' },
          {
            text: 'The simulator is a close copy of how JJS behaves, not the game itself. Timings, physics and damage are near but not exact, and blocking, counters and cooldowns aren’t in it. Always test the finished move in the game.',
          },
          {
            text: 'JJS’s animations aren’t public, so the character plays stand-in poses.',
          },
          {
            text: 'Signing in with Roblox is optional, but a lot of sounds and pictures won’t load without it. Anything a creator keeps private stays private either way.',
          },
          {
            text: 'It’s a fan-made tool. The people who make Jujutsu Shenanigans have nothing to do with it.',
          },
        ],
      },
    ],
  },
];

// Pages that used to be here, by the ?from= their old link arrives with.
const MOVED = {
  'jjs-stuff': 'JJS Stuff',
  'jjs-progress-bar-maker': 'The JJS Progress Bar Maker',
};

// Args: @from (the old page an outdated link pointed at), @onDismiss.
export default class ThirdPartyStuffPage extends Component {
  stuff = STUFF;

  get movedName() {
    return MOVED[this.args.from] ?? null;
  }

  <template>
    <div class="container">
      <section class="hero pop-in">
        <div class="hero-icon"><Icon @name="shapes" @size={{28}} /></div>
        <div class="hero-text">
          <h1 class="hero-title">
            <span>Third Party Stuff</span>
            <FavouriteStar @route="third-party-stuff" @size={{20}} />
          </h1>
          <p>Other things I’ve made that don’t live on this site. They’re not
            tools you open here, so each one says where to get it.</p>
        </div>
      </section>

      {{#if this.movedName}}
        <aside class="tp-moved pop-in" role="status">
          <Icon @name="info" @size={{18}} />
          <div class="tp-moved-text">
            <strong>{{this.movedName}} has moved</strong>
            <p>JJS Stuff and the JJS Progress Bar Maker aren’t on Woogi Tools
              any more. The project grew into its own thing: Arayashiki, a
              desktop app. The templates and the progress bar maker (now called
              the Meter Maker) are both in it, along with a lot that a web page
              couldn’t do. It’s the first one below.</p>
          </div>
          <button
            type="button"
            class="qr-icon-btn"
            aria-label="Dismiss"
            title="Dismiss"
            {{on "click" @onDismiss}}
          ><Icon @name="x" @size={{14}} /></button>
        </aside>
      {{/if}}

      <div class="tp-list pop-in">
        {{#each this.stuff key="id" as |thing|}}
          <article class="tp-item" id={{thing.id}}>
            <header class="tp-head">
              <h2 class="tp-name">{{thing.name}}</h2>
              <span class="updates-badge">{{thing.kind}}</span>
            </header>
            <p class="tp-tagline">{{thing.tagline}}</p>

            {{#each thing.intro as |paragraph|}}
              <p>{{paragraph}}</p>
            {{/each}}

            <div class="tp-links">
              {{#each thing.links as |link|}}
                <a
                  class="btn {{if link.primary 'active'}}"
                  href={{link.url}}
                  target="_blank"
                  rel="noopener noreferrer"
                ><Icon @name={{link.icon}} @size={{14}} /> {{link.label}}</a>
              {{/each}}
            </div>

            {{#each thing.sections as |section|}}
              <h3 class="tp-heading">{{section.title}}</h3>
              <ul class="tp-points">
                {{#each section.items as |item|}}
                  <li>{{#if item.lead}}<strong>{{item.lead}}</strong>
                    {{/if}}{{item.text}}</li>
                {{/each}}
              </ul>
            {{/each}}
          </article>
        {{/each}}
      </div>
    </div>
  </template>
}
