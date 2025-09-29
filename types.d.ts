// declare NEXT_DATA
declare global {
  interface Window {
    __NEXT_DATA__: {
      props: {
        pageProps: any;
      };
    };
  }
}

export {};
