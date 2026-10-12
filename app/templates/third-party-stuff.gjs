import ThirdPartyStuffPage from '../components/third-party-stuff-page';

<template>
  <ThirdPartyStuffPage
    @from={{@controller.from}}
    @onDismiss={{@controller.dismiss}}
  />
</template>
