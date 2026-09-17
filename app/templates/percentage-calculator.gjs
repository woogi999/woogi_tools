import ToolSlot from '../components/tool-slot';
import PercentageCalculatorPage from '../components/percentage-calculator-page';

<template>
  <ToolSlot
    @route="percentage-calculator"
    @component={{PercentageCalculatorPage}}
  />
</template>
