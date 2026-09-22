import ToolSlot from '../components/tool-slot';
import EmailHeaderAnalyzerPage from '../components/email-header-analyzer-page';

<template>
  <ToolSlot
    @route="email-header-analyzer"
    @component={{EmailHeaderAnalyzerPage}}
  />
</template>
