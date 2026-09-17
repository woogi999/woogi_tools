import ToolSlot from '../components/tool-slot';
import GeometryCalculatorPage from '../components/geometry-calculator-page';

<template>
  <ToolSlot
    @route="geometry-calculator"
    @component={{GeometryCalculatorPage}}
  />
</template>
