// Ambient module declaration for recharts. The shipped types/ folder is
// missing from our install (Windows-mount install dropped it). Until the
// next clean reinstall, accept recharts as 'any' so callers compile.
declare module 'recharts';
