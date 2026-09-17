import ToolSlot from '../components/tool-slot';
import GitignoreGeneratorPage from '../components/gitignore-generator-page';

<template>
  <ToolSlot
    @route="gitignore-generator"
    @component={{GitignoreGeneratorPage}}
  />
</template>
