import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { FileInput } from './FileInput';

describe('FileInput rejected-drop feedback', () => {
  const dropOn = (label, ...files) => {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    fireEvent.drop(label, { dataTransfer: transfer });
  };
  const labelOf = () => document.querySelector('input[type="file"]').closest('label');
  const inputOf = () => document.querySelector('input[type="file"]');
  const pdf = (name = 'scan.pdf') => new File(['%PDF'], name, { type: 'application/pdf' });
  const png = (name = 'logo.png') => new File(['png'], name, { type: 'image/png' });

  it('says out loud that the file was refused', () => {
    render(<FileInput label="Company logo" accept="image/*" onChange={vi.fn()} />);
    dropOn(labelOf(), pdf());

    expect(screen.getByRole('alert')).toHaveTextContent(
      'scan.pdf was not added. It is not an accepted file type.',
    );
  });

  it('shows the message visibly, not only to a screen reader', () => {
    // The sighted user who dropped a PDF on an image field needs to know it went
    // nowhere just as much — WCAG 3.3.1 wants the error identified in text.
    render(<FileInput label="Company logo" accept="image/*" onChange={vi.fn()} />);
    dropOn(labelOf(), pdf());

    const alert = screen.getByRole('alert');
    expect(alert).not.toHaveClass('ds-visually-hidden');
    expect(alert).toHaveClass('ds-file-input__error');
  });

  it('is assertive, matching the system\'s rule for an error', () => {
    // `FieldMessage` renders an error as role="alert" and everything else
    // politely. A rejection answers something the user just did.
    render(<FileInput label="Company logo" accept="image/*" onChange={vi.fn()} />);
    expect(screen.queryByRole('alert')).toBeNull();

    dropOn(labelOf(), pdf());

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).not.toHaveAttribute('aria-live', 'polite');
  });

  it('still refuses to hand the file to the consumer', () => {
    const onChange = vi.fn();
    render(<FileInput label="Company logo" accept="image/*" onChange={onChange} />);
    dropOn(labelOf(), pdf());

    expect(onChange).not.toHaveBeenCalled();
    expect(inputOf().files).toHaveLength(0);
  });

  it('marks the control invalid and describes it while the message stands', () => {
    render(<FileInput label="Company logo" accept="image/*" onChange={vi.fn()} />);
    const input = inputOf();
    expect(input).not.toHaveAttribute('aria-invalid');

    dropOn(labelOf(), pdf());

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby'))
      .toContain(screen.getByRole('alert').id);
  });

  it('keeps a caller description and adds the rejection to it', () => {
    render(
      <FileInput
        label="Company logo"
        accept="image/*"
        description="PNG or JPG, under 2 MB"
        onChange={vi.fn()}
      />,
    );
    dropOn(labelOf(), pdf());

    expect(inputOf()).toHaveAccessibleDescription(
      /PNG or JPG, under 2 MB.*was not added/s,
    );
  });

  describe('a mixed drop', () => {
    it('takes the accepted files and reports the refused one', () => {
      const onChange = vi.fn();
      render(<FileInput label="Attachments" accept="image/*" multiple onChange={onChange} />);
      dropOn(labelOf(), png('logo.png'), pdf('resume.pdf'));

      expect(Array.from(onChange.mock.calls[0][0].target.files).map((f) => f.name))
        .toEqual(['logo.png']);
      expect(screen.getByRole('alert')).toHaveTextContent(
        'resume.pdf was not added. It is not an accepted file type.',
      );
    });

    it('does not let the accepted file erase the message it earned', () => {
      // `handleChange` clears the standing rejection, and the drop dispatches
      // that change. If the message were recorded first it would be wiped by its
      // own accepted files.
      render(<FileInput label="Attachments" accept="image/*" multiple onChange={vi.fn()} />);
      dropOn(labelOf(), png(), pdf());

      expect(screen.getByRole('alert')).toHaveTextContent('was not added');
    });

    it('tells a single-file field\'s user that only one file was taken', () => {
      render(<FileInput label="Company logo" accept="image/*" onChange={vi.fn()} />);
      dropOn(labelOf(), png('one.png'), png('two.png'));

      expect(screen.getByRole('alert')).toHaveTextContent(
        'This field takes one file, so only one.png was added.',
      );
    });
  });

  describe('clearing', () => {
    it('clears when a later drop is accepted in full', () => {
      render(<FileInput label="Company logo" accept="image/*" onChange={vi.fn()} />);
      dropOn(labelOf(), pdf());
      expect(screen.getByRole('alert')).toBeInTheDocument();

      dropOn(labelOf(), png());

      expect(screen.queryByRole('alert')).toBeNull();
      expect(inputOf()).not.toHaveAttribute('aria-invalid');
    });

    it('clears when the native picker is used instead', () => {
      render(<FileInput label="Company logo" accept="image/*" onChange={vi.fn()} />);
      dropOn(labelOf(), pdf());
      expect(screen.getByRole('alert')).toBeInTheDocument();

      fireEvent.change(inputOf(), { target: { files: [png()] } });

      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('does not leave the description quoting a message that is gone', () => {
      render(
        <FileInput
          label="Company logo"
          accept="image/*"
          description="PNG or JPG"
          onChange={vi.fn()}
        />,
      );
      dropOn(labelOf(), pdf());
      dropOn(labelOf(), png());

      expect(inputOf()).toHaveAccessibleDescription('PNG or JPG');
    });
  });

  it('stays silent for a drop on a disabled control, which accepts nothing anyway', () => {
    render(<FileInput label="Company logo" accept="image/*" disabled onChange={vi.fn()} />);
    dropOn(labelOf(), pdf());

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not announce a rejection for a drop of files it can all take', () => {
    render(<FileInput label="Attachments" accept="image/*" multiple onChange={vi.fn()} />);
    dropOn(labelOf(), png('a.png'), png('b.png'));

    expect(screen.queryByRole('alert')).toBeNull();
  });

  describe('when the consumer replaces the picker', () => {
    /*
     * Found in review on 2026-08-26 and reproduced before it was fixed.
     *
     * `EnvelopeSidebar` renders `{!file ? <FileInput/> : …}` and `UploadField`
     * renders the picker only in its idle state, so a MIXED drop hands them a
     * file, they re-render, and the component's own alert is unmounted in the
     * commit that created it. The all-refused case was never affected: no file
     * arrives, so nothing unmounts.
     */
    const Swapping = ({ onReject }) => {
      const [file, setFile] = React.useState(null);
      return file
        ? <p>Uploading {file.name}</p>
        : (
          <FileInput
            label="Document"
            accept="application/pdf"
            onChange={(event) => setFile(event.target.files[0])}
            onReject={onReject}
          />
        );
    };

    it('still reports the refused file through onReject', () => {
      const onReject = vi.fn();
      render(<Swapping onReject={onReject} />);
      dropOn(labelOf(), pdf('contract.pdf'), png('logo.png'));

      expect(screen.getByText(/Uploading contract\.pdf/)).toBeInTheDocument();
      expect(onReject).toHaveBeenCalledTimes(1);
      expect(onReject.mock.calls[0][0].message)
        .toBe('logo.png was not added. It is not an accepted file type.');
      expect(onReject.mock.calls[0][0].rejected.map((f) => f.name)).toEqual(['logo.png']);
      expect(onReject.mock.calls[0][0].accepted.map((f) => f.name)).toEqual(['contract.pdf']);
    });

    it('fires onReject AFTER onChange, so a consumer clearing stale state loses nothing', () => {
      // The ordering the fix depends on: a call site that resets its own message
      // in onChange must not wipe the one that arrived with this very drop.
      const order = [];
      render(
        <FileInput
          label="Document"
          accept="application/pdf"
          onChange={() => order.push('change')}
          onReject={() => order.push('reject')}
        />,
      );
      dropOn(labelOf(), pdf('contract.pdf'), png('logo.png'));

      expect(order).toEqual(['change', 'reject']);
    });

    it('does not call onReject when every dropped file is accepted', () => {
      const onReject = vi.fn();
      render(
        <FileInput
          label="Document"
          accept="application/pdf"
          multiple
          onChange={vi.fn()}
          onReject={onReject}
        />,
      );
      dropOn(labelOf(), pdf('a.pdf'), pdf('b.pdf'));

      expect(onReject).not.toHaveBeenCalled();
    });

    it('reports an all-refused drop through onReject too', () => {
      const onReject = vi.fn();
      render(
        <FileInput label="Document" accept="application/pdf" onChange={vi.fn()} onReject={onReject} />,
      );
      dropOn(labelOf(), png('logo.png'));

      expect(onReject).toHaveBeenCalledTimes(1);
      expect(onReject.mock.calls[0][0].message).toBe(
        'logo.png was not added. It is not an accepted file type.',
      );
    });

    it('announces nothing of its own once onReject is passed', () => {
      // Ownership transfers with the callback. Rendering a second live region
      // would put the same sentence on screen twice while the picker is still
      // mounted, and announce it twice.
      render(
        <FileInput
          label="Document"
          accept="application/pdf"
          onChange={vi.fn()}
          onReject={vi.fn()}
        />,
      );
      dropOn(labelOf(), png('logo.png'));

      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('but keeps the field invalid and described, because the input is still there', () => {
      /*
       * Found in review on 2026-08-26. Handing the message over used to discard
       * `aria-invalid` and the description with it, and the consumer's own alert
       * has no id this input could point at — so a screen-reader user who tabbed
       * back to the picker that had just refused their file found a
       * valid-looking control with no reason attached.
       */
      render(
        <FileInput
          label="Document"
          accept="application/pdf"
          onChange={vi.fn()}
          onReject={vi.fn()}
        />,
      );
      dropOn(labelOf(), png('logo.png'));

      const input = inputOf();
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAccessibleDescription(/logo\.png was not added/);
    });

    it('keeps that description silent, so it is read on focus and not on arrival', () => {
      render(
        <FileInput label="Document" accept="application/pdf" onChange={vi.fn()} onReject={vi.fn()} />,
      );
      dropOn(labelOf(), png('logo.png'));

      const described = document.getElementById(inputOf().getAttribute('aria-describedby').trim());
      expect(described).toHaveClass('ds-visually-hidden');
      expect(described).not.toHaveAttribute('role');
    });

    it('clears the invalid state with the message', () => {
      render(
        <FileInput label="Document" accept="application/pdf" onChange={vi.fn()} onReject={vi.fn()} />,
      );
      dropOn(labelOf(), png('logo.png'));
      expect(inputOf()).toHaveAttribute('aria-invalid', 'true');

      dropOn(labelOf(), pdf('contract.pdf'));

      expect(inputOf()).not.toHaveAttribute('aria-invalid');
    });

    it('renders its own message when onReject is absent', () => {
      render(<FileInput label="Document" accept="application/pdf" onChange={vi.fn()} />);
      dropOn(labelOf(), png('logo.png'));

      expect(screen.getByRole('alert')).toHaveTextContent('logo.png was not added');
      expect(inputOf()).toHaveAttribute('aria-invalid', 'true');
    });
  });

  it('has no accessibility violations while showing a rejection', async () => {
    const { container } = render(
      <FileInput label="Company logo" accept="image/*" variant="dropzone" onChange={vi.fn()} />,
    );
    dropOn(labelOf(), pdf());

    expect((await axe(container)).violations).toEqual([]);
  });
});

