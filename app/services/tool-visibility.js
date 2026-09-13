import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';

const TOOLS_KEY = 'woogi-hidden-tools';
const CATEGORIES_KEY = 'woogi-hidden-categories';

function load(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked (private mode): choice still applies for this visit
  }
}

// Everything is shown by default; a route/category only shows up here once hidden.
export default class ToolVisibilityService extends Service {
  @tracked hiddenTools = load(TOOLS_KEY);
  @tracked hiddenCategories = load(CATEGORIES_KEY);

  isToolHidden(route) {
    return this.hiddenTools.includes(route);
  }

  isCategoryHidden(category) {
    return Boolean(category) && this.hiddenCategories.includes(category);
  }

  // A tool is visible if neither it nor its category is hidden.
  isVisible(tool) {
    return !this.isCategoryHidden(tool.category) && !this.isToolHidden(tool.route);
  }

  toggleTool(route) {
    this.hiddenTools = this.isToolHidden(route) ? this.hiddenTools.filter((r) => r !== route) : [...this.hiddenTools, route];
    save(TOOLS_KEY, this.hiddenTools);
  }

  toggleCategory(category) {
    this.hiddenCategories = this.isCategoryHidden(category) ? this.hiddenCategories.filter((c) => c !== category) : [...this.hiddenCategories, category];
    save(CATEGORIES_KEY, this.hiddenCategories);
  }

  resetAll() {
    this.hiddenTools = [];
    this.hiddenCategories = [];
    try {
      localStorage.removeItem(TOOLS_KEY);
      localStorage.removeItem(CATEGORIES_KEY);
    } catch {
      // nothing stored to remove
    }
  }
}
