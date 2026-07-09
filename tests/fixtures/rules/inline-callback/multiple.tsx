const Example = () => (
  <>
    <Button onPress={() => save()} />
    <Component onChange={(value) => update(value)} />
  </>
);
