/* global window */
import config from 'config';
import userEvent from '@testing-library/user-event';
import { waitFor } from '@testing-library/react';

import {
  sendUserAbuseReport,
  loadUserAbuseReport,
} from 'amo/reducers/userAbuseReports';
import { CATEGORY_FEEDBACK_SPAM } from 'amo/components/FeedbackForm';
import { CLIENT_APP_FIREFOX } from 'amo/constants';
import { fetchUserAccount, loadUserAccount } from 'amo/reducers/users';
import { extractId } from 'amo/pages/UserFeedback';
import { clearError } from 'amo/reducers/errors';
import { createApiError } from 'amo/api';
import {
  createUserAccountResponse,
  createFailedErrorHandler,
  createFakeErrorHandler,
  dispatchClientMetadata,
  dispatchSignInActionsWithStore,
  getMockConfig,
  renderPage as defaultRender,
  screen,
} from 'tests/unit/helpers';

jest.mock('config');

describe(__filename, () => {
  let fakeConfig;

  beforeEach(() => {
    fakeConfig = getMockConfig({ enableFeatureFeedbackForm: true });
    config.get.mockImplementation((key) => {
      return fakeConfig[key];
    });

    window.scroll = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks().resetModules();
  });

  const getErrorHandlerId = (addonId) =>
    `src/amo/pages/UserFeedback/index.js-${addonId}`;

  const signInUserWithProps = (
    props = {},
    store = dispatchClientMetadata().store,
  ) => {
    const { id, ...userProps } = props;

    return dispatchSignInActionsWithStore({ userId: id, userProps, store });
  };

  const renderWithoutLoading = ({
    userId,
    lang = 'en-US',
    clientApp = CLIENT_APP_FIREFOX,
    store = dispatchClientMetadata({ lang, clientApp }).store,
  }) => {
    const renderOptions = {
      initialEntries: [`/${lang}/${clientApp}/feedback/user/${userId}/`],
      store,
    };
    return defaultRender(renderOptions);
  };

  const render = (userProps = {}, store = dispatchClientMetadata().store) => {
    const user = createUserAccountResponse(userProps);
    store.dispatch(loadUserAccount({ user }));

    return renderWithoutLoading({ userId: user.id, store });
  };

  describe('error handling', () => {
    it('renders errors', () => {
      const userId = 1234;
      const message = 'Some error message';
      const { store } = dispatchClientMetadata();
      createFailedErrorHandler({
        id: getErrorHandlerId(userId),
        message,
        store,
      });

      render({ id: userId }, store);

      expect(screen.getByText(message)).toBeInTheDocument();

      // We do not call `scroll()` here because we mount the component and
      // `componentDidUpdate()` is not called. It is valid because we only
      // mount the component when the server processes the request OR the user
      // navigates to the feedback form page and, in both cases, the scroll
      // will be at the top of the page.
      expect(window.scroll).not.toHaveBeenCalled();
    });

    it('scrolls to the top of the page when an error is rendered', async () => {
      const userId = 1234;
      const { store } = dispatchClientMetadata();

      render({ id: userId }, store);

      createFailedErrorHandler({ id: getErrorHandlerId(userId), store });

      await waitFor(() => expect(window.scroll).toHaveBeenCalledWith(0, 0));
    });

    it('clears the error handler when unmounting', () => {
      const userId = 1234;
      const { store } = dispatchClientMetadata();
      const dispatch = jest.spyOn(store, 'dispatch');
      createFailedErrorHandler({ id: getErrorHandlerId(userId), store });
      const { unmount } = render({ id: userId }, store);

      unmount();

      expect(dispatch).toHaveBeenCalledWith(
        clearError(getErrorHandlerId(userId)),
      );
    });

    describe('extractId', () => {
      it('returns a unique ID based on params', () => {
        const userId = 8;
        expect(extractId({ match: { params: { userId } } })).toEqual('8');
      });
    });
  });

  it('renders a 404 page when enableFeatureFeedbackForm is false', () => {
    fakeConfig = { ...fakeConfig, enableFeatureFeedbackForm: false };

    render();

    expect(
      screen.getByText('Oops! We can’t find that page'),
    ).toBeInTheDocument();
  });

  it('renders a 404 page when the API returned a 404', () => {
    const userId = 1234;
    const { store } = dispatchClientMetadata();
    createFailedErrorHandler({
      error: createApiError({
        response: { status: 404 },
        apiURL: 'https://some/api/endpoint',
        jsonResponse: { message: 'not found' },
      }),
      id: getErrorHandlerId(userId),
      store,
    });

    render({ id: userId }, store);

    expect(
      screen.getByText('Oops! We can’t find that page'),
    ).toBeInTheDocument();
  });

  it('dispatches fetchUserAccount when the user is not loaded yet', () => {
    const userId = 1234;
    const { store } = dispatchClientMetadata();
    const dispatch = jest.spyOn(store, 'dispatch');
    const errorHandler = createFakeErrorHandler({
      id: getErrorHandlerId(userId),
    });

    renderWithoutLoading({ userId, store });

    expect(dispatch).toHaveBeenCalledWith(
      fetchUserAccount({
        errorHandlerId: errorHandler.id,
        userId: `${userId}`,
      }),
    );
  });

  it('renders the feedback form for a signed out user', () => {
    const username = 'some user name';

    render({ username });

    // Header.
    expect(screen.getByText(username)).toBeInTheDocument();

    expect(screen.getByText(`Report this user to Mozilla`)).toBeInTheDocument();
    expect(screen.getByText('Submit report')).toBeInTheDocument();

    expect(screen.getByLabelText('Your name(optional)')).not.toBeDisabled();
    expect(screen.getByLabelText('Your name(optional)').value).toBeEmpty();
    expect(
      screen.getByLabelText('Your email address(optional)'),
    ).not.toBeDisabled();
    expect(
      screen.getByLabelText('Your email address(optional)').value,
    ).toBeEmpty();

    // This should never be shown for users.
    expect(
      screen.queryByRole('combobox', {
        name: 'Place of the violation (optional)',
      }),
    ).not.toBeInTheDocument();

    // We shouldn't show the confirmation message.
    expect(
      screen.queryByClassName('FeedbackForm-success-first-paragraph'),
    ).not.toBeInTheDocument();
  });

  it('renders the feedback form for a signed in user', () => {
    const signedInUsername = 'signed-in-username';
    const signedInEmail = 'signed-in-email';
    const store = signInUserWithProps({
      username: signedInUsername,
      email: signedInEmail,
    });
    const username = 'some user name';

    render({ username }, store);

    // Header.
    expect(screen.getByText(username)).toBeInTheDocument();

    expect(screen.getByText(`Report this user to Mozilla`)).toBeInTheDocument();
    expect(screen.getByText('Submit report')).toBeInTheDocument();

    const nameInput = screen.getByLabelText('Your name');
    expect(nameInput).toBeDisabled();
    expect(nameInput).toHaveValue(signedInUsername);

    const emailInput = screen.getByLabelText('Your email address');
    expect(emailInput).toBeDisabled();
    expect(emailInput).toHaveValue(signedInEmail);

    // This should never be shown for users.
    expect(
      screen.queryByRole('combobox', {
        name: 'Place of the violation (optional)',
      }),
    ).not.toBeInTheDocument();

    // SignedInUser component should be visible.
    expect(
      screen.getByText(`Signed in as ${signedInUsername}`),
    ).toBeInTheDocument();

    // We shouldn't show the confirmation message.
    expect(
      screen.queryByClassName('FeedbackForm-success-first-paragraph'),
    ).not.toBeInTheDocument();
  });

  it('renders the different categories for a user', () => {
    render();

    // A
    expect(screen.queryByLabelText(/^It doesn’t work/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/^Example: Features are slow/),
    ).not.toBeInTheDocument();

    // B
    expect(screen.getByLabelText('It’s spam')).toBeInTheDocument();
    expect(
      screen.getByText(/^Example: The listing advertises/),
    ).toBeInTheDocument();

    // C
    expect(
      screen.queryByLabelText('It violates Add-on Policies'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/^Example: It compromised/),
    ).not.toBeInTheDocument();

    // D
    expect(screen.getByLabelText(/^It contains hateful/)).toBeInTheDocument();
    expect(
      screen.getByText(/^Example: It contains racist/),
    ).toBeInTheDocument();

    // E
    expect(screen.getByLabelText(/^It violates the law /)).toBeInTheDocument();
    expect(screen.getByText(/^Example: Copyright/)).toBeInTheDocument();

    // F
    expect(screen.getByLabelText('Something else')).toBeInTheDocument();
    expect(screen.getByText(/^Anything that doesn’t/)).toBeInTheDocument();
  });

  it('dispatches sendUserAbuseReport with all fields on submit', async () => {
    const userId = 9999;
    const { store } = dispatchClientMetadata();
    const dispatch = jest.spyOn(store, 'dispatch');

    render({ id: userId }, store);

    await userEvent.click(screen.getByRole('radio', { name: 'It’s spam' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Submit report' }),
    );

    expect(dispatch).toHaveBeenCalledWith(
      sendUserAbuseReport({
        userId,
        errorHandlerId: getErrorHandlerId(userId),
        reporterEmail: '',
        reporterName: '',
        message: '',
        reason: CATEGORY_FEEDBACK_SPAM,
        auth: true,
      }),
    );
  });

  it('shows a certification checkbox when the chosen reason requires it', async () => {
    render();

    expect(
      screen.queryByLabelText(/^By submitting this report I certify/),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('radio', {
        name: 'It violates the law or contains content that violates the law',
      }),
    );

    expect(
      screen.getByLabelText(/^By submitting this report I certify/),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('radio', { name: 'Something else' }),
    );

    expect(
      screen.queryByLabelText(/^By submitting this report I certify/),
    ).not.toBeInTheDocument();
  });

  it('disables the submit button when no reason selected', async () => {
    render();

    expect(
      screen.getByRole('button', { name: 'Submit report' }),
    ).toBeDisabled();
  });

  it('shows success message after submission', async () => {
    const userId = 456;
    const { store } = dispatchClientMetadata();

    render({ id: userId }, store);

    store.dispatch(
      loadUserAbuseReport({ userId, message: 'some message', reporter: null }),
    );

    expect(
      await screen.findByText(
        'We have received your report. Thanks for letting us know.',
      ),
    ).toBeInTheDocument();

    expect(
      screen.queryByText('Report this add-on to Mozilla'),
    ).not.toBeInTheDocument();

    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('renders a submit button with a different text when updating', async () => {
    render();

    await userEvent.click(screen.getByRole('radio', { name: 'It’s spam' }));

    expect(
      screen.getByRole('button', { name: 'Submit report' }),
    ).not.toBeDisabled();

    await userEvent.click(
      screen.getByRole('button', { name: 'Submit report' }),
    );

    expect(
      screen.getByRole('button', { name: 'Submitting your report…' }),
    ).toBeInTheDocument();
  });
});