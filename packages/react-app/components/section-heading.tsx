type SectionHeadingProps = {
    title: string;
  };
  
  export const SectionHeading = ({ title }: SectionHeadingProps) => (
    <h2 className="text-lg font-medium text-black px-4 mt-6 mb-3">
      {title}
    </h2>
  );
  