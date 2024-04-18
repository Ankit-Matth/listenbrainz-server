/*
 * listenbrainz-server - Server for the ListenBrainz project.
 *
 * Copyright (C) 2020 Param Singh <iliekcomputers@gmail.com>
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with this program; if not, write to the Free Software Foundation, Inc.,
 * 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA
 */

import * as React from "react";
import { mount } from "enzyme";
import * as timeago from "time-ago";
import { sortBy } from "lodash";
import { act } from "react-dom/test-utils";
import { BrowserRouter } from "react-router-dom";
import UserFeedPage, {
  UserFeedPageProps,
  UserFeedPageState,
} from "../../src/user-feed/UserFeed";
import UserSocialNetwork from "../../src/user/components/follow/UserSocialNetwork";
import BrainzPlayer from "../../src/common/brainzplayer/BrainzPlayer";
import * as timelineProps from "../__mocks__/timelineProps.json";
import GlobalAppContext, {
  GlobalAppContextT,
} from "../../src/utils/GlobalAppContext";
import APIService from "../../src/utils/APIService";
import { waitForComponentToPaint } from "../test-utils";
import RecordingFeedbackManager from "../../src/utils/RecordingFeedbackManager";

// typescript doesn't recognise string literal values
const props = {
  ...timelineProps,
  events: timelineProps.events as TimelineEvent[],
};

const GlobalContextMock: GlobalAppContextT = {
  APIService: new APIService("base-uri"),
  websocketsUrl: "",
  spotifyAuth: timelineProps.spotify as SpotifyUser,
  youtubeAuth: timelineProps.youtube as YoutubeUser,
  currentUser: timelineProps.currentUser,
  recordingFeedbackManager: new RecordingFeedbackManager(
    new APIService("foo"),
    { name: "Fnord" }
  ),
};

describe("UserFeed", () => {
  beforeAll(() => {
    jest.spyOn(timeago, "ago").mockImplementation(() => "1 day ago");
    // Font Awesome generates a random hash ID for each icon everytime.
    // Mocking Math.random() fixes this
    // https://github.com/FortAwesome/react-fontawesome/issues/194#issuecomment-627235075
    jest.spyOn(global.Math, "random").mockImplementation(() => 0);
  });
  it("renders correctly", () => {
    const wrapper = mount(
      <GlobalAppContext.Provider value={GlobalContextMock}>
        <BrowserRouter>
          <UserFeedPage {...props} />
        </BrowserRouter>
      </GlobalAppContext.Provider>
    );
    expect(wrapper.find("#timeline")).toHaveLength(1);
    // contains a UserSocialNetwork component
    expect(wrapper.find(UserSocialNetwork)).toHaveLength(1);
  });

  it("renders the correct number of timeline events", () => {
    const wrapper = mount(
      <GlobalAppContext.Provider value={GlobalContextMock}>
        <BrowserRouter>
          <UserFeedPage {...props} />
        </BrowserRouter>
      </GlobalAppContext.Provider>
    );
    const ulElement = wrapper.find("#timeline > ul");
    expect(ulElement).toHaveLength(1);
    expect(ulElement.children()).toHaveLength(props.events.length);
    expect(ulElement.childAt(0).is(".timeline-event")).toBeTruthy();
  });

  it("renders recording recommendation events", () => {
    const date: Date = new Date("2021-09-14T03:16:16.161Z"); // 3AM UTC
    const dateNowMock = jest
      .spyOn(Date, "now")
      .mockImplementation(() => date.getTime());
    const wrapper = mount(
      <GlobalAppContext.Provider value={GlobalContextMock}>
        <BrowserRouter>
          <UserFeedPage {...props} />
        </BrowserRouter>
      </GlobalAppContext.Provider>
    );
    const recEvent = wrapper.find("#timeline > ul >li").at(0);
    const description = recEvent.find(".event-description-text");
    expect(description.text()).toEqual("reosarevok recommended a track");
    const content = recEvent.find(".event-content");
    expect(content.exists()).toBeTruthy();
    expect(content.children()).toHaveLength(1);
    const time = recEvent.find(".event-time");
    expect(time.text().includes("Mar 02, 7:48 PM")).toBe(true);
    dateNowMock.mockRestore();
  });

  it("renders follow relationship events", () => {
    const date: Date = new Date("2021-09-14T03:16:16.161Z"); // 3AM UTC
    const dateNowMock = jest
      .spyOn(Date, "now")
      .mockImplementation(() => date.getTime());
    const wrapper = mount(
      <GlobalAppContext.Provider value={GlobalContextMock}>
        <BrowserRouter>
          <UserFeedPage {...props} />
        </BrowserRouter>
      </GlobalAppContext.Provider>
    );
    const followedEvent = wrapper.find("#timeline > ul >li").at(3);
    let description = followedEvent.find(".event-description-text");
    expect(description.text()).toEqual("You are now following reosarevok");
    let content = followedEvent.find(".event-content");
    expect(content.exists()).toBeFalsy();
    let time = followedEvent.find(".event-time");
    expect(time.text().includes("Feb 16, 11:21 AM")).toBe(true);

    const followEvent = wrapper.find("#timeline > ul >li").at(4);
    description = followEvent.find(".event-description-text");
    expect(description.text()).toEqual("reosarevok is now following you");
    content = followEvent.find(".event-content");
    expect(content.exists()).toBeFalsy();
    time = followEvent.find(".event-time");
    expect(time.text().includes("Feb 16, 11:20 AM")).toBe(true);
    dateNowMock.mockRestore();
  });

  it("renders notification events", () => {
    const date: Date = new Date("2021-09-14T03:16:16.161Z"); // 3AM UTC
    const dateNowMock = jest
      .spyOn(Date, "now")
      .mockImplementation(() => date.getTime());
    const wrapper = mount(
      <GlobalAppContext.Provider value={GlobalContextMock}>
        <BrowserRouter>
          <UserFeedPage {...props} />
        </BrowserRouter>
      </GlobalAppContext.Provider>
    );
    const notificationEvent = wrapper.find("#timeline > ul >li").at(5);
    const description = notificationEvent.find(".event-description-text");
    // Ensure it parsed and reconstituted the html message
    expect(description.text()).toEqual(
      // @ts-ignore
      `We have created a playlist for you: My top discoveries of 2020`
    );
    expect(description.html()).toEqual(
      // @ts-ignore
      '<span class="event-description-text">We have created a playlist for you: <a href="https://listenbrainz.org/playlist/4245ccd3-4f0d-4276-95d6-2e09d87b5546">My top discoveries of 2020</a></span>'
    );
    const content = notificationEvent.find(".event-content");
    expect(content.exists()).toBeFalsy();
    const time = notificationEvent.find(".event-time");
    expect(time.text().includes("Feb 16, 11:17 AM")).toBe(true);
    dateNowMock.mockRestore();
  });

  it("renders recording pin events", () => {
    const date: Date = new Date("2021-09-14T03:16:16.161Z"); // 3AM UTC
    const dateNowMock = jest
      .spyOn(Date, "now")
      .mockImplementation(() => date.getTime());
    const wrapper = mount(
      <GlobalAppContext.Provider value={GlobalContextMock}>
        <BrowserRouter>
          <UserFeedPage {...props} />
        </BrowserRouter>
      </GlobalAppContext.Provider>
    );
    const recEvent = wrapper.find("#timeline > ul >li").at(11);
    const description = recEvent.find(".event-description-text");
    expect(description.text()).toEqual("jdaok pinned a track");
    const content = recEvent.find(".event-content");
    expect(content.exists()).toBeTruthy();
    expect(content.children()).toHaveLength(1);
    const time = recEvent.find(".event-time");
    expect(time.text().includes("Feb 16, 10:44 AM")).toBe(true);

    // Ensure additional details are rendered if provided
    const additionalContent = content.find(".additional-content");
    expect(additionalContent.text()).toEqual("Very good...");
    dateNowMock.mockRestore();
  });

  describe("Pagination", () => {
    const pushStateSpy = jest.spyOn(window.history, "pushState");

    afterEach(() => {
      jest.clearAllMocks();
    });

    describe("handleClickOlder", () => {
      it("does nothing if there is no older events timestamp", async () => {
        const spy = jest.fn().mockImplementation(() => Promise.resolve([]));
        const wrapper = mount(
          <BrowserRouter>
            <UserFeedPage {...props} />
          </BrowserRouter>,
          {
            context: {
              APIService: { getFeedForUser: spy },
            },
          }
        );
        await waitForComponentToPaint(wrapper);
        const instance = wrapper.find(UserFeedPage).instance() as UserFeedPage;
        await act(async () => {
          instance?.setState({ nextEventTs: undefined });
          await instance.handleClickOlder();
        });

        await waitForComponentToPaint(wrapper);
        expect(instance.state.nextEventTs).toBeUndefined();

        expect(instance.state.loading).toBeFalsy();
        expect(spy).not.toHaveBeenCalled();
      });

      it("calls the API to get older events", async () => {
        const wrapper = mount(
          <GlobalAppContext.Provider value={GlobalContextMock}>
            <BrowserRouter>
              <UserFeedPage {...props} />
            </BrowserRouter>
          </GlobalAppContext.Provider>
        );
        await waitForComponentToPaint(wrapper);
        const instance = wrapper.find(UserFeedPage).instance() as UserFeedPage;
        await act(async () => {
          instance?.setState({ nextEventTs: 1586450000 });
        });
        expect(instance.state.nextEventTs).toEqual(1586450000);
        const expectedEventsArray = [
          {
            event_type: "follow",
            created: 1613474472,
            metadata: {
              user_0: "iliekcomputers",
              user_1: "reosarevok",
              type: "follow",
            },
            user_id: "iliekcomputers",
          },
        ];
        const spy = jest
          .fn()
          .mockImplementation(() => Promise.resolve(expectedEventsArray));

        instance.context.APIService.getFeedForUser = spy;
        await act(async () => {
          await instance.handleClickOlder();
        });
        await waitForComponentToPaint(wrapper);

        expect(spy).toHaveBeenCalledWith(
          props.currentUser.name,
          props.currentUser.auth_token,
          undefined,
          1586450000
        );
        expect(instance.state.loading).toBeFalsy();
        expect(instance.state.events).toEqual(expectedEventsArray);
      });

      it("sets nextEventTs to undefined if it receives no events from API", async () => {
        const timestamp = 1586450000;
        const propsCopy = { ...props };
        propsCopy.events[propsCopy.events.length - 1].created = timestamp;

        const wrapper = mount(
          <GlobalAppContext.Provider value={GlobalContextMock}>
            <BrowserRouter>
              <UserFeedPage {...propsCopy} />
            </BrowserRouter>
          </GlobalAppContext.Provider>
        );
        const instance = wrapper.find(UserFeedPage).instance() as UserFeedPage;

        expect(instance.state.nextEventTs).toEqual(timestamp);

        const spy = jest.fn().mockImplementation(() => Promise.resolve([]));
        instance.context.APIService.getFeedForUser = spy;

        await act(async () => {
          await instance.handleClickOlder();
        });
        await waitForComponentToPaint(wrapper);

        expect(spy).toHaveBeenCalledWith(
          props.currentUser.name,
          props.currentUser.auth_token,
          undefined,
          timestamp
        );
        expect(instance.state.loading).toBeFalsy();
        expect(instance.state.nextEventTs).toBeUndefined();
        expect(pushStateSpy).not.toHaveBeenCalled();
      });

      it("sets the events, nextEventTs and  previousEventTs on the state and updates browser history", async () => {
        const wrapper = mount(
          <GlobalAppContext.Provider value={GlobalContextMock}>
            <BrowserRouter>
              <UserFeedPage {...props} />
            </BrowserRouter>
          </GlobalAppContext.Provider>
        );

        const instance = wrapper.find(UserFeedPage).instance() as UserFeedPage;

        await waitForComponentToPaint(wrapper);
        await act(() => {
          // Random nextEventTs to ensure that is the value set in browser history
          instance?.setState({ events: [], nextEventTs: 1586440600 });
        });

        expect(instance.state.events).toEqual([]);
        expect(instance.state.nextEventTs).toEqual(1586440600);

        const sortedEvents = sortBy(props.events, "created").reverse();
        const nextEventTs = sortedEvents[sortedEvents.length - 1].created;
        const previousEventTs = sortedEvents[0].created;

        const spy = jest.fn().mockImplementation((username, minTs, maxTs) => {
          return Promise.resolve(sortedEvents);
        });
        instance.context.APIService.getFeedForUser = spy;

        await act(async () => {
          await instance.handleClickOlder();
        });
        await waitForComponentToPaint(wrapper);

        expect(instance.state.events).toEqual(sortedEvents);
        expect(instance.state.loading).toBeFalsy();
        expect(instance.state.nextEventTs).toEqual(nextEventTs);
        expect(instance.state.previousEventTs).toEqual(previousEventTs);
        expect(pushStateSpy).toHaveBeenCalledWith(
          null,
          "",
          `?max_ts=1586440600`
        );
      });
    });

    describe("handleClickNewer", () => {
      it("does nothing if there is no newer events timestamp", async () => {
        const spy = jest.fn().mockImplementation(() => Promise.resolve([]));
        const wrapper = mount(
          <GlobalAppContext.Provider value={GlobalContextMock}>
            <BrowserRouter>
              <UserFeedPage {...props} />
            </BrowserRouter>
          </GlobalAppContext.Provider>
        );
        await waitForComponentToPaint(wrapper);
        const instance = wrapper.find(UserFeedPage).instance() as UserFeedPage;
        instance.context.APIService.getFeedForUser = spy;
        await act(() => {
          instance?.setState({ previousEventTs: undefined });
        });
        expect(instance.state.previousEventTs).toBeUndefined();

        await act(async () => {
          await instance.handleClickNewer();
        });
        await waitForComponentToPaint(wrapper);

        expect(instance.state.loading).toBeFalsy();
        expect(spy).not.toHaveBeenCalled();
      });

      it("calls the API to get newer events", async () => {
        const wrapper = mount(
          <GlobalAppContext.Provider value={GlobalContextMock}>
            <BrowserRouter>
              <UserFeedPage {...props} />
            </BrowserRouter>
          </GlobalAppContext.Provider>
        );
        await waitForComponentToPaint(wrapper);
        const instance = wrapper.find(UserFeedPage).instance() as UserFeedPage;
        await act(() => {
          instance?.setState({ previousEventTs: 123456 });
        });
        expect(instance.state.previousEventTs).toEqual(123456);

        const expectedEventsArray = [
          {
            event_type: "follow",
            created: 1613474472,
            metadata: {
              user_0: "iliekcomputers",
              user_1: "reosarevok",
              type: "follow",
            },
            user_id: "iliekcomputers",
          },
        ];
        const spy = jest
          .fn()
          .mockImplementation(() => Promise.resolve(expectedEventsArray));
        instance.context.APIService.getFeedForUser = spy;

        await act(async () => {
          await instance.handleClickNewer();
        });
        await waitForComponentToPaint(wrapper);

        expect(instance.state.events).toEqual(expectedEventsArray);
        expect(instance.state.loading).toBeFalsy();
        expect(spy).toHaveBeenCalledWith(
          props.currentUser.name,
          props.currentUser.auth_token,
          123456,
          undefined
        );
      });

      it("sets previousEventTs to undefined if it receives no events from API", async () => {
        const wrapper = mount(
          <GlobalAppContext.Provider value={GlobalContextMock}>
            <BrowserRouter>
              <UserFeedPage {...props} />
            </BrowserRouter>
          </GlobalAppContext.Provider>
        );
        await waitForComponentToPaint(wrapper);
        const instance = wrapper.find(UserFeedPage).instance() as UserFeedPage;

        await act(() => {
          instance.setState({ previousEventTs: 123456 });
        });
        expect(instance.state.previousEventTs).toEqual(123456);

        const spy = jest.fn().mockImplementation(() => Promise.resolve([]));

        instance.context.APIService.getFeedForUser = spy;
        await act(async () => {
          await instance.handleClickNewer();
        });

        expect(instance.state.loading).toBeFalsy();
        expect(instance.state.previousEventTs).toBeUndefined();
        expect(pushStateSpy).not.toHaveBeenCalled();
      });

      it("sets the events, nextEventTs and  previousEventTs on the state and updates browser history", async () => {
        const wrapper = mount(
          <GlobalAppContext.Provider value={GlobalContextMock}>
            <BrowserRouter>
              <UserFeedPage {...props} />
            </BrowserRouter>
          </GlobalAppContext.Provider>
        );
        await waitForComponentToPaint(wrapper);

        const instance = wrapper.find(UserFeedPage).instance() as UserFeedPage;
        await act(() => {
          instance.setState({ previousEventTs: 123456 });
        });
        expect(instance.state.previousEventTs).toEqual(123456);

        const sortedEvents = sortBy(props.events, "created");
        instance.context.APIService.getFeedForUser = jest.fn(
          (username, minTs, maxTs) => {
            return Promise.resolve(sortedEvents);
          }
        );

        const nextEventTs = sortedEvents[props.events.length - 1].created;
        const previousEventTs = sortedEvents[0].created;
        await act(async () => {
          await instance.handleClickNewer();
        });

        expect(instance.state.events).toEqual(sortedEvents);
        expect(instance.state.loading).toBeFalsy();
        expect(instance.state.nextEventTs).toEqual(nextEventTs);
        expect(instance.state.previousEventTs).toEqual(previousEventTs);
        expect(pushStateSpy).toHaveBeenCalledWith(null, "", `?min_ts=123456`);
      });
    });
  });
});
