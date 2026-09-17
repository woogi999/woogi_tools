import ToolSlot from '../components/tool-slot';
import WordCounterPage from '../components/word-counter-page';

<template>
  <ToolSlot @route="word-counter" @component={{WordCounterPage}} />
</template>
