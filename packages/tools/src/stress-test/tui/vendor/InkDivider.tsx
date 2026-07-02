import { Box, type BoxProps, Text, type TextProps } from 'ink';

// Vendored/adapted from `ink-divider` (MIT): https://github.com/JureSotosek/ink-divider
// Adaptations:
// - local ESM/TSX module to avoid nested Ink/React runtime issues

type DividerProps = {
  title?: string;
  width?: 'auto' | number;
  padding?: number;
  titlePadding?: number;
  titleColor?: TextProps['color'];
  dividerChar?: string;
  dividerColor?: BoxProps['borderColor'];
  boxProps?: BoxProps;
};

const DividerLine = ({
  width = 'auto',
  dividerChar,
  dividerColor = 'gray',
  boxProps,
}: {
  width?: 'auto' | number;
  dividerChar?: string;
  dividerColor?: BoxProps['borderColor'];
  boxProps?: BoxProps;
}) => (
  <Box
    width={width}
    borderStyle={{
      topLeft: '',
      top: '',
      topRight: '',
      right: '',
      bottomRight: '',
      bottom: dividerChar ?? '─',
      bottomLeft: '',
      left: '',
    }}
    borderColor={dividerColor}
    flexGrow={1}
    borderBottom
    borderTop={false}
    borderLeft={false}
    borderRight={false}
    {...boxProps}
  />
);

export default function InkDivider({
  title,
  width = 'auto',
  padding = 0,
  titlePadding = 1,
  titleColor = 'white',
  dividerChar = '─',
  dividerColor = 'gray',
  boxProps,
}: DividerProps) {
  const line = (
    <DividerLine
      width={width}
      dividerChar={dividerChar}
      dividerColor={dividerColor}
      boxProps={boxProps}
    />
  );

  if (!title) {
    return (
      <Box paddingLeft={padding} paddingRight={padding}>
        {line}
      </Box>
    );
  }

  return (
    <Box width={width} paddingLeft={padding} paddingRight={padding} gap={titlePadding}>
      {line}
      <Box>
        <Text color={titleColor}>{title}</Text>
      </Box>
      {line}
    </Box>
  );
}
