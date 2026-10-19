import './styles/app.scss';
import { mount } from 'svelte';
import App from './app.svelte';
import { service } from './core/services.js';

service('router').start();
mount(App, { target: document.body });
