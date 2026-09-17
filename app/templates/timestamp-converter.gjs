import ToolSlot from '../components/tool-slot';
import TimestampConverterPage from '../components/timestamp-converter-page';

<template>
  <ToolSlot
    @route="timestamp-converter"
    @component={{TimestampConverterPage}}
  />
</template>
