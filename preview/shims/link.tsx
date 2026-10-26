import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { navigate } from './navigation';

export default function Link({ href, children, ...rest }: { href: string; children?: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={'#' + href} {...rest} onClick={(e) => {
      rest.onClick?.(e);
      if (rest.target === '_blank') return;
      e.preventDefault();
      navigate(href);
    }}>{children}</a>
  );
}
