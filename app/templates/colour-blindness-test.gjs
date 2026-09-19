import ToolSlot from '../components/tool-slot';
import ColourBlindnessTestPage from '../components/colour-blindness-test-page';

<template>
  <ToolSlot
    @route="colour-blindness-test"
    @component={{ColourBlindnessTestPage}}
  />
</template>
