import ToolSlot from '../components/tool-slot';
import BaybayinTranslatorPage from '../components/baybayin-translator-page';

<template>
  <ToolSlot
    @route="baybayin-translator"
    @component={{BaybayinTranslatorPage}}
  />
</template>
