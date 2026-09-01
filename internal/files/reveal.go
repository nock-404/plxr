package files

/* Show a file where the system shows files.

   Every desktop has one and every desktop calls it something else, so the name
   here says what it does rather than naming anybody's file manager. Which
   program is asked, and how it is told to select the file rather than merely
   open its folder, is the one part that differs — and that part lives in the
   file for each system.
*/

// Reveal opens the system's file manager with this path selected.
func Reveal(root, path string) error {
	full, err := resolve(root, path)
	if err != nil {
		return err
	}
	return reveal(full)
}
